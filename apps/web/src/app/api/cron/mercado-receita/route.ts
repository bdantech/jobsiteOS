import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararJob } from '@/lib/mercado/worker'

/**
 * Monthly: Receita Federal CNPJ dump → apps/worker (`POST /jobs/receita`).
 *
 * Vercel cannot do this work itself (multi-GB CSVs), so this route is pure
 * plumbing: authenticate the cron, hand off, return. The worker owns the
 * download, the retries with backoff, `mercado_ingestoes` and the
 * mercado.ingestao_falhou notification.
 *
 * It ALWAYS asks for the primary source. `fallback: false` is not a default here
 * — it is the rule (spec §3.1): the mirror is only ever used by an admin
 * pressing "Reexecutar com fallback" on /mercado/ingestoes, after seeing why the
 * primary source failed. A cron that silently fell back to a third-party mirror
 * would make the data's provenance unknowable.
 *
 * Schedule: apps/web/vercel.json (day 10 — the month's dump is published in the
 * first half of the month, and by day 10 it is reliably up).
 */

// Reads headers and calls out: never prerender, never cache.
export const dynamic = 'force-dynamic'
// node:crypto (timing-safe secret compare, in ../auth) is not on the edge runtime.
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) {
    // No detail: an unauthorised caller learns nothing about why.
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  const resultado = await dispararJob({ job: 'receita_cnpj', origem: 'cron', fallback: false })

  if (!resultado.ok) {
    // 5xx so Vercel records the cron invocation as failed and it shows up in the
    // dashboard, instead of a green 200 hiding a worker that never got the job.
    return NextResponse.json(
      { ok: false, job: 'mercado-receita', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    job: 'mercado-receita',
    ingestaoId: resultado.ingestaoId,
    disparadoEm: new Date().toISOString(),
  })
}

// Vercel Cron issues GET. POST exists so the same job can be fired by hand with
// the bearer secret, without a second, differently-guarded route.
export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
