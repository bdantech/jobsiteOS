import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararTriagemComunicacao } from '@/lib/mercado/worker'

/**
 * Triagem das entradas (05A §6): classifica, registra opt-out, escala para humano e move o card no primeiro contato.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararTriagemComunicacao()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'comunicacao-triagem', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'comunicacao-triagem', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
