import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararQualidadeProcessar } from '@/lib/mercado/worker'

/**
 * A fila de análise das conversas (05C §4). O webhook já dispara quando a transcrição chega;
 * este cron é a garantia.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararQualidadeProcessar()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'qualidade-processar', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'qualidade-processar', disparadoEm: new Date().toISOString() })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
