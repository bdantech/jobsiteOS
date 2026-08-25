import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararAlertaReclassificacao } from '@/lib/mercado/worker'

/**
 * Semanal: aponta contas passivas cujo volume recente desabou contra a média dos três
 * meses anteriores. SINALIZA — nunca reclassifica.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const r = await dispararAlertaReclassificacao()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'comercial-reclassificacao', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({
    ok: true,
    job: 'comercial-reclassificacao',
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
