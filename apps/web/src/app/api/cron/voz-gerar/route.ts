import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararVozGerar } from '@/lib/mercado/worker'

/**
 * Quem a Ana vai ligar hoje.
 *
 * Uma vez por dia, de manhã, depois da reclassificação do funil: a régua já
 * rodou, as faixas estão frescas, e o que entra na fila é o que vale ligar hoje.
 * Gerar não liga para ninguém — quem faz isso é o `/api/cron/voz-enviar`.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararVozGerar()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'voz-gerar', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'voz-gerar', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
