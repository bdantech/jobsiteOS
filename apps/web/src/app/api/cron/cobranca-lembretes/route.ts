import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararLembretesCobranca } from '@/lib/mercado/worker'

/**
 * Lembretes diários da Cobrança (Prompt 07 §14) → apps/worker
 * (`POST /jobs/cobranca/lembretes`): reiteração devida, documento complementar pedido
 * pela seguradora perto do prazo, e protesto de título já quitado sem instrução de
 * cancelamento.
 *
 * 11:00 UTC (08:00 em São Paulo), duas horas DEPOIS do relógio: os lembretes são do
 * expediente, e o relógio já fechou o dia antes deles. Nenhum lembrete dispara nada —
 * reiterar, responder a seguradora e retirar o protesto são atos de gente.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararLembretesCobranca()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'cobranca-lembretes', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'cobranca-lembretes', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
