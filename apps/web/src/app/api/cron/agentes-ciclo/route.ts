import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararCicloAgentes } from '@/lib/mercado/worker'

/**
 * O ciclo dos agentes (Prompt 09 §6) → apps/worker (`POST /jobs/agentes/ciclo`).
 *
 * A cada 5 minutos: um agente que combinou ligar às 15h30 precisa ligar às 15h30, e
 * granularidade de hora não serve. O worker é single-flight — um ciclo longo nunca
 * cruza com o seguinte.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararCicloAgentes()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'agentes-ciclo', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'agentes-ciclo', disparadoEm: new Date().toISOString() })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
