import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararSequenciaCampanhas } from '@/lib/mercado/worker'

/**
 * Segundo e terceiro toque (05B §5). Diário, porque \`dias_apos\` é medido em dias. Para no primeiro sinal: resposta, opt-out, supressão ou ação do Agente.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararSequenciaCampanhas()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'campanhas-sequencia', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'campanhas-sequencia', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
