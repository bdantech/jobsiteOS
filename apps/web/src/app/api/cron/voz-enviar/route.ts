import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararVozEnviar } from '@/lib/mercado/worker'

/**
 * Leva a fila para a Ana.
 *
 * De trinta em trinta minutos dentro do dia: ela liga UMA POR VEZ, então mandar
 * mais rápido não faz ligar mais rápido — só empilha do lado de lá. O intervalo
 * também é o que dá espaço para uma retentativa de envio acontecer no mesmo dia.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararVozEnviar()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'voz-enviar', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'voz-enviar', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
