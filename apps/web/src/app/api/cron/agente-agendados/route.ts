import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararAgenteAgendados } from '@/lib/mercado/worker'

/**
 * Varre conversas.proxima_acao_em e apura o desfecho das decisões já executadas (05A §7.6).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararAgenteAgendados()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'agente-agendados', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'agente-agendados', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
