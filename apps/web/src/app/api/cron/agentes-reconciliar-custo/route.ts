import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararReconciliarCusto } from '@/lib/mercado/worker'

/**
 * A reconciliação do custo dos agentes (Prompt 09 §8) → `POST /jobs/agentes/reconciliar-custo`.
 *
 * 06:00 UTC = 03:00 em São Paulo, todo dia: reservas órfãs voltam ao saldo, o custo real
 * das ligações substitui o estimado, e os totais são recalculados dos movimentos.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararReconciliarCusto()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'agentes-reconciliar-custo', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'agentes-reconciliar-custo', disparadoEm: new Date().toISOString() })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
