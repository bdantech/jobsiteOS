import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararTranscreverComunicacao } from '@/lib/mercado/worker'

/**
 * Transcrição dos áudios do WhatsApp (0292): retoma o que o disparo imediato do webhook não fechou.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararTranscreverComunicacao()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'comunicacao-transcrever', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'comunicacao-transcrever', disparadoEm: new Date().toISOString() })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
