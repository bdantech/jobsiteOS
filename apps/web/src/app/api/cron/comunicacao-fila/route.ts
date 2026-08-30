import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararEnviarFilaComunicacao } from '@/lib/mercado/worker'

/**
 * Fila de envio (05A §5): consome as mensagens aprovadas, aplica janela, teto e warmup, envia e grava no ledger.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararEnviarFilaComunicacao()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'comunicacao-fila', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'comunicacao-fila', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
