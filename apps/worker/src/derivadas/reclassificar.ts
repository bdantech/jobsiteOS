import type pg from 'pg'
import type { Consultavel } from '../db.js'
import type {
  CamadaComRegra,
  PreviaDestino,
  PreviaRegra,
} from '../../../../packages/core/src/mercado/schemas.js'
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

  // The mass UPDATE of `camada` above dirties the visibility map, which is exactly
  // what the pyramid (mercado_piramide) relies on: its `group by camada` is an
  // INDEX-ONLY scan that only stays ~1s while pages are all-visible. Without this
  // VACUUM it degrades to a full 587MB heap scan (~9s) and blows past the 8s
  // statement_timeout — the Camadas tab stops loading until autovacuum eventually
  // catches up. Restoring all-visible here keeps the tab fast right after a save.
  // Runs outside a transaction (the dedicated session is autocommit), as VACUUM
  // requires, and the session's statement_timeout is 0 so it is never cut off.
  await client.query('vacuum (analyze) mercado_universo')

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

/**
 * "Esta regra move 12.400 empresas: 9.100 sobem para SAM, 3.300 descem (para TAM)."
 *
 * Counts what WOULD happen if `definicao` replaced the active rule for `camada`,
 * leaving the other layers on their current active rules — which is what the user
 * is about to do when they confirm. It writes nothing.
 *
 * ONE sequential scan of `mercado_explorador`, and every number is the TRUTH the
 * apply will produce, not an estimate: `nova` is the very CASE the reclassification
 * runs (`expressaoCamada`, highest matching layer wins), so a company that also
 * matches an active rule ABOVE this layer gets `nova` = that higher layer and is
 * correctly not counted as climbing INTO it. The `destinos` breakdown is just that
 * same `nova`, grouped — no second pass, no subtraction gymnastics.
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

  // Rules compile to $1..$n; the previewed layer is the last placeholder.
  const { sql, values } = expressaoCamada(propostas)
  const pCamada = `$${values.length + 1}`

  const { rows } = await db.query<{
    subindo: number
    descendo: number
    permanecem: number
    destinos: PreviaDestino[]
  }>(
    `with simulado as (
       select coalesce(camada, 'universo') as atual, (${sql})::text as nova
       from mercado_explorador
       where cnpj is not null
     )
     select
       count(*) filter (where atual <> ${pCamada} and nova = ${pCamada})::int as subindo,
       count(*) filter (where atual = ${pCamada} and nova <> ${pCamada})::int as descendo,
       count(*) filter (where atual = ${pCamada} and nova = ${pCamada})::int as permanecem,
       coalesce(
         (select jsonb_agg(jsonb_build_object('camada', nova, 'total', c) order by c desc)
          from (
            select nova, count(*)::int as c
            from simulado
            where atual = ${pCamada} and nova <> ${pCamada}
            group by nova
          ) d),
         '[]'::jsonb
       ) as destinos
     from simulado`,
    [...values, camada],
  )

  const r = rows[0] ?? { subindo: 0, descendo: 0, permanecem: 0, destinos: [] }

  return {
    camada,
    subindo: r.subindo,
    descendo: r.descendo,
    permanecem: r.permanecem,
    destinos: r.destinos,
    totalMovidas: r.subindo + r.descendo,
  }
}
