import {
  FONTES_INGESTAO,
  STATUS_INGESTAO,
  type FonteIngestao,
  type StatusIngestao,
  type Tables,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * Reads for the Ingestões page.
 *
 * They run in the BROWSER against the anon key + the user's session, so RLS
 * applies: `mercado_ingestoes` is SELECT-only for `authenticated` and gated by
 * app_tem_modulo('mercado') (migration 0012). A user without the module gets
 * zero rows. The worker writes these rows with the service role, from Railway —
 * nothing in the web app ever inserts or updates them.
 *
 * Triggering a run is NOT here: it is a server action (src/actions/mercado-worker.ts),
 * because it carries the WORKER_SECRET and requires an admin.
 */

export type Ingestao = Tables<'mercado_ingestoes'>

/** Enough history to answer "did last month run?" without paginating an admin page. */
export const LIMITE_INGESTOES = 100

export const ingestoesKeys = {
  all: ['mercado', 'ingestoes'] as const,
  lista: (fonte: FonteIngestao | null, status: StatusIngestao | null) =>
    ['mercado', 'ingestoes', 'lista', fonte, status] as const,
}

/**
 * `fonte` and `status` are plain `text` columns (CHECK-constrained, not enums),
 * so what arrives over the wire is `string`. These are the boundary where an
 * unknown value becomes a typed one — a row written by a future worker version
 * renders as itself instead of crashing the table.
 */
export function isFonteIngestao(valor: string): valor is FonteIngestao {
  return (FONTES_INGESTAO as readonly string[]).includes(valor)
}

export function isStatusIngestao(valor: string): valor is StatusIngestao {
  return (STATUS_INGESTAO as readonly string[]).includes(valor)
}

export async function buscarIngestoes(
  fonte: FonteIngestao | null,
  status: StatusIngestao | null,
): Promise<Ingestao[]> {
  const supabase = createClient()

  let query = supabase
    .from('mercado_ingestoes')
    .select('*')
    .order('iniciado_em', { ascending: false })
    .limit(LIMITE_INGESTOES)

  if (fonte) query = query.eq('fonte', fonte)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

/** A run of THIS fonte is in flight — the trigger buttons for it must be blocked. */
export function fontesEmExecucao(ingestoes: readonly Ingestao[]): Set<string> {
  return new Set(ingestoes.filter((i) => i.status === 'executando').map((i) => i.fonte))
}

export function temExecucaoAtiva(ingestoes: readonly Ingestao[]): boolean {
  return ingestoes.some((i) => i.status === 'executando')
}

/**
 * Polling intervals.
 *
 * `mercado_ingestoes` is NOT in the `supabase_realtime` publication — migration
 * 0010 added `notificacoes` and nothing else, and this agent may not write
 * migrations. So the page polls: fast while something is running (the row must
 * visibly change), slow otherwise (an admin page left open on a second monitor
 * must not hammer PostgREST all day).
 */
export const INTERVALO_EXECUTANDO_MS = 5_000
export const INTERVALO_OCIOSO_MS = 60_000
