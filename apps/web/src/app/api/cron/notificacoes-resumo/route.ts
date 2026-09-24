import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararResumoNotificacoes } from '@/lib/mercado/worker'

/**
 * O resumo diário de avisos (0262): às 8h de Brasília, nos dias úteis — a mesma
 * hora do "Bom dia" do Meu Dia, para a manhã chegar num bloco só.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararResumoNotificacoes()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'notificacoes-resumo', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'notificacoes-resumo', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
