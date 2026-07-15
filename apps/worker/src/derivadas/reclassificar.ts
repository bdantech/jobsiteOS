import type pg from 'pg'
import type { Consultavel } from '../db.js'
import type { CamadaComRegra } from '../../../../packages/core/src/mercado/schemas.js'
import { logger } from '../logger.js'
import { expressaoCamada, regrasAtivas, type RegraAtiva } from './regras.js'

export interface ResultadoReclassificacao {
  avaliadas: number
  movidas: number
  por_camada: Record<string, number>
  eventos: number
  regras: Record<string, number>
}

/**
 * Applies the active `camada_regras` to the WHOLE universe.
 *
 * Bulk, never row by row: `mercado_universo` holds ~2M rows, and a PostgREST
 * round trip per row would take days. One scan of `mercado_explorador` assigns
 * every CNPJ its highest matching layer into a temp table; the writes that follow
 * touch only the rows that actually CHANGED.
 *
 * `mercado_explorador` is the right source and not `mercado_universo`: half the
 * catalog (obras_ativas, qtd_filiais, erp_atual, tem_contato…) lives in
 * `mercado_metricas` and `empresas`, and a rule may name any of it. It also
 * carries the list-imported companies that never passed through staging — they
 * get classified too, which is why `empresas.camada` is updated separately below.
 */
export async function reclassificar(client: pg.Client): Promise<ResultadoReclassificacao> {
  const regras = await regrasAtivas(client)
  const { sql, values, versoes } = expressaoCamada(regras)

  logger.info({ regras: versoes }, 'Reclassificando o universo.')

  // DDL first, INSERT … SELECT second. `create temp table … as select $1` mixes a
  // utility statement with bind parameters, and that is exactly the kind of thing
  // that works on one Postgres version and not the next.
  await client.query('drop table if exists stg_reclass')
  await client.query('create temp table stg_reclass (cnpj text primary key, camada text not null)')
  await client.query(
    `insert into stg_reclass (cnpj, camada)
     select cnpj, (${sql})::text
     from mercado_explorador
     where cnpj is not null`,
    values,
  )
  await client.query('analyze stg_reclass')

  const { rows: distribuicao } = await client.query<{ camada: string; total: number }>(
    'select camada, count(*)::int as total from stg_reclass group by camada',
  )
  const porCamada: Record<string, number> = {}
  let avaliadas = 0
  for (const r of distribuicao) {
    porCamada[r.camada] = r.total
    avaliadas += r.total
  }

  // Events BEFORE the update — they need the OLD layer. Only companies that exist
  // in `empresas` get one: a staging row has no timeline to write to, and its
  // history lives in the mercado_ingestoes counters (§3.2). This covers promoted
  // companies AND list-imported ones, which is exactly the set with an empresa_id.
  const eventos = await client.query(
    `insert into empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
     select
       e.id,
       'camada.alterada',
       jsonb_build_object(
         'resumo', coalesce(e.razao_social, e.cnpj) || ' mudou de camada: '
                   || upper(coalesce(e.camada, 'universo')) || ' → ' || upper(r.camada) || '.',
         'de', e.camada,
         'para', r.camada,
         'regra_versao', ($1::jsonb ->> r.camada)::int
       ),
       null
     from empresas e
     join stg_reclass r on r.cnpj = e.cnpj
     where coalesce(e.camada, 'universo') is distinct from r.camada`,
    [JSON.stringify(versoes)],
  )

  const universo = await client.query(
    `update mercado_universo u
     set camada = r.camada,
         camada_regra_versao = ($1::jsonb ->> r.camada)::int,
         camada_atualizada_em = now()
     from stg_reclass r
     where r.cnpj = u.cnpj
       and u.camada is distinct from r.camada`,
    [JSON.stringify(versoes)],
  )

  const empresas = await client.query(
    `update empresas e
     set camada = r.camada
     from stg_reclass r
     where r.cnpj = e.cnpj
       and coalesce(e.camada, 'universo') is distinct from r.camada`,
    [],
  )

  const resultado: ResultadoReclassificacao = {
    avaliadas,
    movidas: universo.rowCount ?? 0,
    por_camada: porCamada,
    eventos: eventos.rowCount ?? 0,
    regras: versoes,
  }

  logger.info(
    { ...resultado, empresas_atualizadas: empresas.rowCount ?? 0 },
    'Reclassificação concluída.',
  )
  return resultado
}

// ─── Dry-run (§5.1) ─────────────────────────────────────────────────────────

export interface PreviaRegra {
  camada: string
  versao_proposta: number
  total_atual: number
  total_novo: number
  movidas: number
  sobem: number
  descem: number
  resumo: string
}

const ORDEM = ['universo', 'tam', 'sam', 'som']

/**
 * "Esta regra move 12.400 empresas: 9.100 sobem para SAM, 3.300 descem para TAM."
 *
 * Counts what WOULD happen if `definicao` replaced the active rule for `camada`,
 * leaving the other layers on their current active rules — which is what the user
 * is actually about to do when they click "Salvar como nova versão". It writes
 * nothing.
 */
export async function previewRegra(
  db: Consultavel,
  camada: CamadaComRegra,
  definicao: unknown,
): Promise<PreviaRegra> {
  const ativas = await regrasAtivas(db)
  const versaoAtual = ativas.find((r) => r.camada === camada)?.versao ?? 0

  const propostas: RegraAtiva[] = [
    ...ativas.filter((r) => r.camada !== camada),
    { camada, versao: versaoAtual + 1, definicao },
  ]

  // $1 is the layer-order array, so the compiled rules start at $2.
  const { sql, values } = expressaoCamada(propostas, 1)

  const { rows } = await db.query<{
    total_atual: number
    total_novo: number
    movidas: number
    sobem: number
    descem: number
  }>(
    `with simulado as (
       select camada as atual, (${sql})::text as nova
       from mercado_explorador
       where cnpj is not null
     )
     select
       count(*) filter (where atual = $${values.length + 2})::int as total_atual,
       count(*) filter (where nova  = $${values.length + 2})::int as total_novo,
       count(*) filter (where atual is distinct from nova)::int as movidas,
       count(*) filter (
         where array_position($1::text[], nova) > array_position($1::text[], coalesce(atual, 'universo'))
       )::int as sobem,
       count(*) filter (
         where array_position($1::text[], nova) < array_position($1::text[], coalesce(atual, 'universo'))
       )::int as descem
     from simulado`,
    [ORDEM, ...values, camada],
  )

  const r = rows[0] ?? { total_atual: 0, total_novo: 0, movidas: 0, sobem: 0, descem: 0 }
  const n = (v: number): string => v.toLocaleString('pt-BR')

  return {
    camada,
    versao_proposta: versaoAtual + 1,
    ...r,
    resumo:
      `Esta regra move ${n(r.movidas)} empresas: ${n(r.sobem)} sobem e ${n(r.descem)} descem. ` +
      `A camada ${camada.toUpperCase()} passa de ${n(r.total_atual)} para ${n(r.total_novo)} empresas.`,
  }
}
