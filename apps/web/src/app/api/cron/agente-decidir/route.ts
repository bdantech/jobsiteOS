import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararAgenteDecidir } from '@/lib/mercado/worker'

/**
 * Agente de próximo passo (05A §7): decide o que fazer nas conversas que responderam ou silenciaram.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararAgenteDecidir()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'agente-decidir', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'agente-decidir', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
