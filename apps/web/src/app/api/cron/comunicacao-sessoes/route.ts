import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararVerificarSessoes } from '@/lib/mercado/worker'

/**
 * Os números de WhatsApp estão conectados? O worker pergunta ao Wasender e avisa o
 * dono do número que caiu (0277).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararVerificarSessoes()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'comunicacao-sessoes', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'comunicacao-sessoes', disparadoEm: new Date().toISOString() })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
