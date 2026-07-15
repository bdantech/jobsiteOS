import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararJob } from '@/lib/mercado/worker'

/**
 * Monthly: CNO (obras) open data → apps/worker (`POST /jobs/cno`).
 *
 * Same contract as mercado-receita: authenticate, hand off, return. The worker
 * downloads CNO_SOURCE_URL, filters to obras whose ni_responsavel matches a CNPJ
 * raiz we already know, upserts `mercado_obras` and refreshes the obra-derived
 * metrics.
 *
 * Runs a couple of days AFTER the Receita job so the universe it filters against
 * is already the current month's. `fallback: false` for the same reason as
 * Receita (spec §3.1): a mirror is an admin's decision, never a schedule's.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  const resultado = await dispararJob({ job: 'cno', origem: 'cron', fallback: false })

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'mercado-cno', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    job: 'mercado-cno',
    ingestaoId: resultado.ingestaoId,
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
