import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararSlaComercial } from '@/lib/mercado/worker'

/**
 * Diário: devolve ao pool o lead a contatar parado além do SLA e cobra vendedor sem movimento (em dias ÚTEIS).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const r = await dispararSlaComercial()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'comercial-sla', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'comercial-sla', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
