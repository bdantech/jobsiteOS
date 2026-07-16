import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../../packages/core/src/types/database.js'
import type { Supabase } from '../../../packages/core/src/registry/types.js'
import { env } from './env.js'

const { Pool, Client } = pg

/**
 * Two clients, on purpose:
 *
 *   pg (direct)   — COPY FROM STDIN and the bulk UPDATEs compiled by
 *                   compileToSql(). PostgREST can do neither: there is no COPY
 *                   over HTTP, and a 2M-row reclassification cannot be 2M round
 *                   trips. Connects as the database owner, so RLS does not apply.
 *
 *   supabase-js   — the service-role client, for the places where PostgREST is
 *                   plenty (reading `camada_regras`, writing `mercado_ingestoes`)
 *                   and, above all, for notify(), which is written against it.
 *
 * numeric/int8 come back as strings by default (node-pg refuses to silently lose
 * precision). We only ever aggregate them into counters, so the parsers below
 * make that explicit rather than leaving `"12"` to land in an int column.
 */
pg.types.setTypeParser(20, (v) => Number(v)) // int8
pg.types.setTypeParser(1700, (v) => Number(v)) // numeric

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 4,
  // An ingestion statement can legitimately run for tens of minutes.
  statement_timeout: 60 * 60 * 1000,
  idleTimeoutMillis: 30_000,
})

export type PgClient = pg.PoolClient | pg.Client

/**
 * Anything that can run a query: the pool, a pooled client, or the dedicated
 * session. Code that does NOT depend on session state (no TEMP tables, no COPY)
 * takes this and can then run on the pool — `/jobs/preview-regra` is the case that
 * matters, since it must answer while a user waits.
 */
export interface Consultavel {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>
}

/**
 * A dedicated, unpooled session. The ingestion creates TEMP tables and streams
 * COPY into them; both are session state, and a pooled connection may hand the
 * next statement to a different backend that has never heard of them.
 */
export async function sessaoDedicada(): Promise<pg.Client> {
  const client = new Client({
    connectionString: env.DATABASE_URL,
    statement_timeout: 6 * 60 * 60 * 1000,
  })
  await client.connect()

  // O `statement_timeout` acima vai como PARÂMETRO DE STARTUP do node-pg, e o proxy
  // do Supabase na 5432 (Supavisor em modo sessão) descarta esses parâmetros — a sessão
  // caía no default curto do servidor e o COPY do maior arquivo (Estabelecimentos)
  // estourava com "canceling statement due to statement timeout". Um SET explícito é
  // uma query normal, que o proxy não toca. 0 = sem limite: esta é uma sessão de lote
  // de uso único (COPY + upsert de ~2M linhas + índices + derivadas), e matar qualquer
  // um desses no meio corrompe a corrida. A trava contra query travada é operacional
  // (healthcheck/restart), não um timeout que aborta trabalho legítimo.
  await client.query('set statement_timeout = 0')
  return client
}

export const supabaseAdmin: Supabase = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

export async function pingDb(): Promise<boolean> {
  try {
    await pool.query('select 1')
    return true
  } catch {
    return false
  }
}
