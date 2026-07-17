import 'server-only'
import type { CamadaComRegra, PreviaRegra } from '@jobsiteos/core'

/**
 * The ONE place in the web app that talks to `apps/worker` (Railway).
 *
 * ─── WHY IT LIVES HERE AND NOT IN actions/mercado-worker.ts ─────────────────
 * A `'use server'` module may only export async functions, and every export it
 * has becomes a callable RPC endpoint reachable by any authenticated browser.
 * `dispararJob()` carries the WORKER_SECRET and must never be one of those: it
 * is called from an admin-gated server action AND from two cron routes, which
 * authorise very differently. So it sits in a plain server-only module that both
 * import, and the authorisation stays in the callers.
 *
 * WORKER_URL and WORKER_SECRET are SERVER-ONLY (never NEXT_PUBLIC_*). The
 * `server-only` import above turns an accidental client import into a build
 * error rather than a leaked bearer token. The secret is never logged, never put
 * in an error message, and never returned to the UI.
 */

/** fonte -> worker route. `lista` is deliberately absent: list imports are not a worker job. */
const ROTAS: Record<'receita_cnpj' | 'cno', string> = {
  receita_cnpj: '/jobs/receita',
  cno: '/jobs/cno',
}

/**
 * Reclassification is NOT a `mercado_ingestoes.fonte` — it is not an ingestion, it
 * reclassifies what was already ingested. So it gets its own route and stays out of
 * ROTAS, whose keys must remain exactly the fontes the Ingestões screen can re-fire.
 */
const ROTA_RECLASSIFICAR = '/jobs/reclassificar'

/** The subset of `mercado_ingestoes.fonte` the worker can actually run. */
export type JobWorker = keyof typeof ROTAS

export const JOBS_WORKER = Object.keys(ROTAS) as JobWorker[]

/** `fonte` comes back from Postgres as plain `text`. This is the boundary that types it. */
export function isJobWorker(fonte: string): fonte is JobWorker {
  return Object.prototype.hasOwnProperty.call(ROTAS, fonte)
}

export interface DispararJobInput {
  job: JobWorker
  /** Who pulled the trigger. The worker stores it in mercado_ingestoes.meta. */
  origem: 'cron' | 'admin'
  /**
   * Use the manual mirror (RECEITA_FALLBACK_URL / CNO fallback) instead of the
   * primary source. Spec §3.1: the fallback is NEVER automatic — only an admin,
   * only after a failed run. Cron must always pass false.
   */
  fallback: boolean
  /** The failed run this re-run descends from, for traceability in `meta`. */
  reexecucaoDe?: string
}

export type DispararJobResultado =
  | { ok: true; ingestaoId: string | null }
  | { ok: false; message: string; code: 'config' | 'rede' | 'worker' }

/**
 * The worker only ENQUEUES here (the real job runs for hours), so this call
 * should return in milliseconds. A generous ceiling still bounds a hung Railway
 * container instead of holding a Vercel function open until the platform kills it.
 */
const TIMEOUT_MS = 15_000

/** A worker error body could be an HTML stack trace. Keep it short and single-line. */
function trecho(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim()
  return limpo.length > 200 ? `${limpo.slice(0, 200)}…` : limpo
}

function ingestaoIdDe(corpo: unknown): string | null {
  if (typeof corpo !== 'object' || corpo === null) return null
  const registro = corpo as Record<string, unknown>
  const valor = registro.ingestao_id ?? registro.ingestaoId
  return typeof valor === 'string' && valor.length > 0 ? valor : null
}

/**
 * The ONE function that reads the secret and speaks HTTP. Every worker call in the
 * app funnels through here, so the bearer token has exactly one code path to leak
 * from — and it never does: it lives in a header, never in a log, never in a
 * returned message, never in an error.
 *
 * Never throws. Callers get a discriminated result they can turn into a pt-BR
 * message (server action) or an HTTP status (cron route).
 */
async function postar(
  rota: string,
  corpoJson: unknown,
  rotulo: string,
): Promise<DispararJobResultado> {
  const baseUrl = process.env.WORKER_URL
  const secret = process.env.WORKER_SECRET

  // Fail closed and loudly: a deploy missing these must not look like a worker
  // that simply has nothing to do.
  if (!baseUrl || !secret) {
    return {
      ok: false,
      code: 'config',
      message: 'O worker do Mercado não está configurado (WORKER_URL / WORKER_SECRET).',
    }
  }

  let url: string
  try {
    url = new URL(rota, baseUrl).toString()
  } catch {
    return { ok: false, code: 'config', message: 'WORKER_URL inválida.' }
  }

  let resposta: Response
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(corpoJson),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    // Do not surface `error` verbatim: on a bad WORKER_URL it contains the host.
    console.error('[mercado] falha de rede ao chamar o worker', {
      job: rotulo,
      erro: error instanceof Error ? error.name : 'desconhecido',
    })
    return {
      ok: false,
      code: 'rede',
      message: 'Não foi possível falar com o worker. Verifique se o serviço está no ar.',
    }
  }

  if (!resposta.ok) {
    const corpo = trecho(await resposta.text().catch(() => ''))
    console.error('[mercado] worker recusou o job', { job: rotulo, status: resposta.status })

    // 401/403 means OUR secret is wrong — an admin can fix that, so say it plainly.
    const message =
      resposta.status === 401 || resposta.status === 403
        ? 'O worker recusou a autenticação. Confira o WORKER_SECRET nos dois lados.'
        : `O worker respondeu ${resposta.status}${corpo ? `: ${corpo}` : '.'}`

    return { ok: false, code: 'worker', message }
  }

  const corpo: unknown = await resposta.json().catch(() => null)
  return { ok: true, ingestaoId: ingestaoIdDe(corpo) }
}

/** Fire an ingestion job (Receita / CNO). */
export async function dispararJob(input: DispararJobInput): Promise<DispararJobResultado> {
  return postar(
    ROTAS[input.job],
    {
      fallback: input.fallback,
      origem: input.origem,
      reexecucao_de: input.reexecucaoDe ?? null,
    },
    input.job,
  )
}

export interface ReclassificarInput {
  camada: string
  regraId: string
  versao: number
}

/**
 * Activating a camada rule is only half the job: the universe still carries the
 * layers the OLD rule assigned. The worker owns the bulk reclassification (2M rows,
 * a direct pg connection, compileToSql) — this just wakes it up.
 *
 * The promotion threshold is deliberately NOT sent. It used to be pushed in the
 * body, and the worker never read it — it used its own CAMADA_PROMOCAO env var,
 * so an admin who chose "somente manual" in the UI would still watch the next
 * ingestion auto-promote. The worker now reads `app_config` straight from the
 * database (the only owner), and the ingestion path gets the same value the UI
 * shows — which the body param never could, since cron-triggered ingestions have
 * no body from us at all.
 */
export async function dispararReclassificacao(
  input: ReclassificarInput,
): Promise<DispararJobResultado> {
  return postar(
    ROTA_RECLASSIFICAR,
    {
      camada: input.camada,
      regra_id: input.regraId,
      versao: input.versao,
    },
    'reclassificar',
  )
}

// ─── Prévia da regra (§5.1) ─────────────────────────────────────────────────

export type PreverRegraResultado =
  | { ok: true; previsao: PreviaRegra }
  | { ok: false; message: string }

/**
 * A count over the whole universe under RLS times out at 8s in the browser, so the
 * dry-run lives on the worker: it holds a direct pg connection with no statement
 * timeout AND uses compileToSql — the exact compiler the reclassification runs, so
 * the numbers shown here cannot disagree with what applying the rule will do.
 *
 * Unlike dispararJob (which only ENQUEUES and returns in ms), this WAITS for the
 * scan (~a few seconds). The ceiling is generous but still bounds a hung container.
 */
const PREVIEW_TIMEOUT_MS = 30_000

function ehPreviaRegra(x: unknown): x is PreviaRegra {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.camada === 'string' &&
    typeof o.subindo === 'number' &&
    typeof o.descendo === 'number' &&
    typeof o.permanecem === 'number' &&
    typeof o.totalMovidas === 'number' &&
    Array.isArray(o.destinos)
  )
}

export async function preverRegraNoWorker(
  camada: CamadaComRegra,
  definicao: unknown,
): Promise<PreverRegraResultado> {
  const baseUrl = process.env.WORKER_URL
  const secret = process.env.WORKER_SECRET
  if (!baseUrl || !secret) {
    return { ok: false, message: 'O worker do Mercado não está configurado (WORKER_URL / WORKER_SECRET).' }
  }

  let url: string
  try {
    url = new URL('/jobs/preview-regra', baseUrl).toString()
  } catch {
    return { ok: false, message: 'WORKER_URL inválida.' }
  }

  let resposta: Response
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ camada, definicao }),
      cache: 'no-store',
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
    })
  } catch (error) {
    console.error('[mercado] falha de rede na prévia da regra', {
      erro: error instanceof Error ? error.name : 'desconhecido',
    })
    return {
      ok: false,
      message:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'A prévia demorou demais para responder. Tente novamente em instantes.'
          : 'Não foi possível falar com o worker. Verifique se o serviço está no ar.',
    }
  }

  if (!resposta.ok) {
    const corpo = trecho(await resposta.text().catch(() => ''))
    console.error('[mercado] worker recusou a prévia', { status: resposta.status })
    return {
      ok: false,
      message:
        resposta.status === 401 || resposta.status === 403
          ? 'O worker recusou a autenticação. Confira o WORKER_SECRET nos dois lados.'
          : `O worker respondeu ${resposta.status} ao calcular a prévia${corpo ? `: ${corpo}` : '.'}`,
    }
  }

  const corpo: unknown = await resposta.json().catch(() => null)
  if (!ehPreviaRegra(corpo)) {
    return { ok: false, message: 'O worker devolveu uma prévia em formato inesperado.' }
  }
  return { ok: true, previsao: corpo }
}
