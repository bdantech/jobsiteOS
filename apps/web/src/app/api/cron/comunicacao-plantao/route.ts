import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararPlantao } from '@/lib/mercado/worker'

/**
 * Plantão interno (05A §1.5): alerta crítico por WhatsApp, em transporte separado do canal de mercado.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararPlantao()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'comunicacao-plantao', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'comunicacao-plantao', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
