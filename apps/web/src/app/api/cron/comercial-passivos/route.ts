import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararSugerirPassivos } from '@/lib/mercado/worker'

/**
 * Dia 2: sugere contas passivas — cliente que antecipa sozinho e não recebeu toque. SUGERE e notifica; quem muda é gente.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const r = await dispararSugerirPassivos()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'comercial-passivos', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'comercial-passivos', disparadoEm: new Date().toISOString() })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
