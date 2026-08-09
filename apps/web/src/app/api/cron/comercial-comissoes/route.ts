import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararApurarComissoes } from '@/lib/mercado/worker'

/**
 * Dia 1: fecha a competência anterior. O gestor aprova antes de pagar; nada aqui muda status para pago.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const r = await dispararApurarComissoes()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'comercial-comissoes', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'comercial-comissoes', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
