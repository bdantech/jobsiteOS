import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararQualidadeVinculacao } from '@/lib/mercado/worker'

/**
 * A cascata de vinculação de contas a empresas (05C §10).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararQualidadeVinculacao()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'qualidade-vinculacao', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'qualidade-vinculacao', disparadoEm: new Date().toISOString() })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
