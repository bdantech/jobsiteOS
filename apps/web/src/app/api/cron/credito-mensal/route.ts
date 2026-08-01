import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararCreditoMensal } from '@/lib/mercado/worker'

/**
 * Crédito, mensal (04d §2 e §3) → apps/worker (`POST /jobs/credito/mensal`): calibra na
 * carteira, pontua a base e calcula o potencial, NESTA ordem e na mesma corrida.
 *
 * Roda no dia 7, um dia depois do estimador de faturamento (dia 6), e por um motivo: o
 * limite potencial é uma proporção do FATURAMENTO ESTIMADO. Rodar antes calcularia
 * limites sobre a estimativa do mês passado e os gravaria como snapshot — virando
 * história errada, que é pior que número faltando.
 *
 * Sem cliente com faturamento declarado não há ratio limite/faturamento, e o job não
 * grava limite nenhum. Deliberado: um coeficiente inventado preencheria a base inteira de
 * limites plausíveis e errados.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararCreditoMensal()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'credito-mensal', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'credito-mensal', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
