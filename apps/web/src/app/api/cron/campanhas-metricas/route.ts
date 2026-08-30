import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararMetricasCampanhas } from '@/lib/mercado/worker'

/**
 * Saúde de canal (05B §6). Varre as campanhas vivas para o caso de NINGUÉM estar olhando — campanha ruim queima domínio e número.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararMetricasCampanhas()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'campanhas-metricas', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'campanhas-metricas', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
