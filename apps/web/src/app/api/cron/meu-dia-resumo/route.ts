import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararResumoMeuDia } from '@/lib/mercado/worker'

/**
 * 8h de São Paulo, de segunda a sexta: o resumo do Meu Dia de cada vendedor.
 *
 * `0 11 * * 1-5` em UTC — a mesma conversão da distribuição de segunda, que roda às
 * 10h UTC para chegar às 7h de SP.
 *
 * DIA ÚTIL, e não todo dia: uma lista de trabalho que procura a pessoa no sábado é a
 * forma mais rápida de ela desligar a notificação — e quem desliga no sábado desliga
 * para a terça também.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const r = await dispararResumoMeuDia()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'comercial-meu-dia-resumo', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({
    ok: true,
    job: 'comercial-meu-dia-resumo',
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
