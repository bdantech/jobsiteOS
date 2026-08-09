import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararDistribuirSdr } from '@/lib/mercado/worker'

/**
 * Segunda 07:00 SP: distribui empresas do SOM para os SDRs de saída, ordenadas por valor esperado. Segunda de manhã, e não domingo à noite — um lead que chega quando ninguém trabalha já nasce com um dia de SLA queimado.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const r = await dispararDistribuirSdr()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'comercial-distribuir', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'comercial-distribuir', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
