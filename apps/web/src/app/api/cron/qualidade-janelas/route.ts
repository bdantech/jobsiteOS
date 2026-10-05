import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararQualidadeJanelas } from '@/lib/mercado/worker'

/**
 * Fecha as janelas de conversa do dia (05C §2) e expurga transcrição vencida (§12).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararQualidadeJanelas()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'qualidade-janelas', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'qualidade-janelas', disparadoEm: new Date().toISOString() })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
