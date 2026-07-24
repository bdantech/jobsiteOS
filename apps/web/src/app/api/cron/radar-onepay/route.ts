import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararSincronizarOnepay } from '@/lib/mercado/worker'

/**
 * Diário: sync dos clientes Onepay → apps/worker (`POST /jobs/radar/onepay`).
 *
 * Mesmo contrato dos crons do Mercado: autentica com CRON_SECRET, faz o hand-off
 * pro worker (que autentica com WORKER_SECRET) e volta. O worker puxa o
 * temperature-report, faz upsert em clientes_onepay + snapshot e emite eventos.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  const resultado = await dispararSincronizarOnepay()

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'radar-onepay', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }

  return NextResponse.json({ ok: true, job: 'radar-onepay', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
