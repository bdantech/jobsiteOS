import type pg from 'pg'
import { CAMADA_PROMOCAO_PADRAO } from '../../../../packages/core/src/constants.js'
import { logger } from '../logger.js'

export interface ResultadoPromocao {
  camada_minima: string
  adotadas: number
  promovidas: number
}

const ORDEM = ['universo', 'tam', 'sam', 'som'] as const
const VALIDAS = new Set(['tam', 'sam', 'som', 'manual'])

/**
 * The threshold comes from `app_config` (migration 0016), NOT from an env var.
 *
 * It used to be `env.CAMADA_PROMOCAO`, and that was a split brain: the Pirâmide
 * writes the setting to the database, so an admin who set "somente manual" in the
 * UI would watch the next Receita ingestion auto-promote anyway — at whatever the
 * Railway env var happened to say — silently promoting the very companies they
 * had just excluded. One setting, two owners, and the one the admin could see was
 * the one that lost.
 *
 * The worker holds a direct Postgres connection, so there is no reason for it to
 * guess. The env var is gone; the database is the single owner.
 */
async function camadaMinima(client: pg.ClientBase): Promise<string> {
  const { rows } = await client.query<{ valor: string }>(
    `select valor #>> '{}' as valor from public.app_config where chave = 'mercado.promocao_camada'`,
  )

  const valor = rows[0]?.valor
  if (valor && VALIDAS.has(valor)) return valor

  // No row (a database that predates 0016) or a hand-edited nonsense value. Fall
  // back to the shared default rather than promoting on a guess.
  logger.warn(
    { valor },
    'app_config[mercado.promocao_camada] ausente ou inválida — usando o padrão.',
  )
  return CAMADA_PROMOCAO_PADRAO
}

/**
 * Auto-promotion (§3.2.5). Rows that reached the threshold become `empresas`,
 * where they gain a timeline, notes and events.
 *
 * Same semantics as `app_promover_empresa` (migration 0013), reproduced in bulk:
 *   - idempotent — a CNPJ already promoted is skipped, not re-inserted;
 *   - it ADOPTS an existing empresa with the same CNPJ (list imports never pass
 *     through staging, so the row may already be there) rather than colliding on
 *     the unique CNPJ;
 *   - estagio = 'mercado', because promotion is a CLASSIFICATION event — nobody
 *     has talked to them yet. camada and estagio are different axes.
 *   - it logs `empresa.promovida`.
 *
 * The RPC is not reused: it promotes ONE cnpj per call under SECURITY INVOKER,
 * and the worker has no auth.uid() and may have 40.000 companies to promote.
 */
export async function promoverElegiveis(client: pg.ClientBase): Promise<ResultadoPromocao> {
  const minima = await camadaMinima(client)

  if (minima === 'manual') {
    logger.info('Promoção automática desligada (app_config: mercado.promocao_camada = manual).')
    return { camada_minima: 'manual', adotadas: 0, promovidas: 0 }
  }

  const elegiveis = ORDEM.slice(ORDEM.indexOf(minima as (typeof ORDEM)[number])) as readonly string[]

  // 1. Adopt: the company already exists in `empresas` (a list import, which skips
  //    staging) and the staging row just doesn't know about it yet. Same semantics
  //    as app_promover_empresa after migration 0015 — carry the market
  //    classification across, but never overwrite what the import established:
  //    coalesce keeps origem = 'lista' and leaves a hand-set camada alone.
  const adotadas = await client.query(
    `update mercado_universo u
     set empresa_id = e.id
     from empresas e
     where e.cnpj = u.cnpj and u.empresa_id is null`,
  )

  await client.query(
    `update empresas e
     set camada      = coalesce(e.camada, u.camada),
         grupo_id    = coalesce(e.grupo_id, u.grupo_id),
         is_spe      = e.is_spe or u.is_spe,
         grafo_sefaz = e.grafo_sefaz or u.grafo_sefaz,
         origem      = coalesce(e.origem, 'mercado')
     from mercado_universo u
     where u.empresa_id = e.id
       and (e.camada is null or e.grupo_id is null or e.origem is null
            or (u.is_spe and not e.is_spe) or (u.grafo_sefaz and not e.grafo_sefaz))`,
  )

  // 2. Promote the rest, and backfill empresa_id + the event in the same statement.
  //
  // MATRIZ ONLY. A filial is not a company you sell to — it is the same customer
  // with a different suffix, and `qtd_filiais` already carries that fact. Promoting
  // every establishment would put "ALFA CONSTRUTORA" in the base four times, each
  // with its own timeline, and no amount of UI can undo that. A human can still
  // promote a specific filial by hand through app_promover_empresa, which
  // deliberately takes any CNPJ — this restriction is on the AUTOMATIC path only.
  const { rows } = await client.query<{ promovidas: number }>(
    `with elegiveis as (
       select u.*
       from mercado_universo u
       where u.empresa_id is null
         and u.camada = any($1::text[])
         and coalesce(u.matriz_filial, 'matriz') <> 'filial'
     ),
     novas as (
       insert into empresas (
         cnpj, razao_social, nome_fantasia, tipo, estagio,
         uf, municipio, cnae_principal, porte,
         camada, grupo_id, is_spe, grafo_sefaz, origem
       )
       select
         e.cnpj, e.razao_social, e.nome_fantasia, 'construtora', 'mercado',
         e.uf, e.municipio, e.cnae_principal, e.porte_rfb,
         e.camada, e.grupo_id, e.is_spe, e.grafo_sefaz, 'mercado'
       from elegiveis e
       on conflict (cnpj) do nothing
       returning id, cnpj, razao_social, camada
     ),
     vinculadas as (
       update mercado_universo u
       set empresa_id = n.id
       from novas n
       where n.cnpj = u.cnpj
       returning u.cnpj
     ),
     eventos as (
       insert into empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
       select
         n.id,
         'empresa.promovida',
         jsonb_build_object(
           'resumo', coalesce(n.razao_social, n.cnpj)
                     || ' foi promovida do universo (camada ' || coalesce(n.camada, '—') || ').',
           'camada', n.camada,
           'origem', 'mercado'
         ),
         null
       from novas n
       returning 1
     )
     select (select count(*) from vinculadas)::int as promovidas`,
    [elegiveis],
  )

  const resultado: ResultadoPromocao = {
    camada_minima: minima,
    adotadas: adotadas.rowCount ?? 0,
    promovidas: rows[0]?.promovidas ?? 0,
  }

  logger.info(resultado, 'Promoção concluída.')
  return resultado
}
