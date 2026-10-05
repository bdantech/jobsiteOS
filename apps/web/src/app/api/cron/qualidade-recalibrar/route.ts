import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararQualidadeRecalibrar } from '@/lib/mercado/worker'

/**
 * Recalibra as rubricas que pediram (05C §5).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararQualidadeRecalibrar()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'qualidade-recalibrar', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'qualidade-recalibrar', disparadoEm: new Date().toISOString() })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
