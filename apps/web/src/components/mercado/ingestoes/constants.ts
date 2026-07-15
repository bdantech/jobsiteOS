import type { FonteIngestao } from '@jobsiteos/core'

/**
 * The fontes the worker can actually run.
 *
 * `lista` is an ingestion too (it lands rows in `empresas`), but it is produced
 * by a human uploading a spreadsheet in the Importador — there is no job to
 * re-fire, so it gets no buttons here.
 *
 * This mirrors the `ROTAS` map in src/lib/mercado/worker.ts on purpose. That
 * module is `server-only` (it holds the WORKER_SECRET) and importing it from a
 * client component would be a build error — correctly so. Two lines duplicated
 * is the cheap half of that trade.
 */
export const JOBS_DO_WORKER = ['receita_cnpj', 'cno'] as const satisfies readonly FonteIngestao[]

export type JobDoWorker = (typeof JOBS_DO_WORKER)[number]

export function isJobDoWorker(fonte: string): fonte is JobDoWorker {
  return (JOBS_DO_WORKER as readonly string[]).includes(fonte)
}

/** Sentinel for "sem filtro": Radix Select forbids an empty-string item value. */
export const TODOS = '__todos__'
