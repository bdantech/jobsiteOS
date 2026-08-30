import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararExecutarCampanhas } from '@/lib/mercado/worker'

/**
 * Executor de campanhas (05B §4): materializa o público na primeira passada, enfileira a leva do dia no ritmo configurado e conclui o que acabou. Não envia — quem envia é a fila de comunicação, que aplica o portão no instante do envio.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararExecutarCampanhas()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'campanhas-executar', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'campanhas-executar', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
