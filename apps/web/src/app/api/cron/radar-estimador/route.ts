import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararEstimadorMensal } from '@/lib/mercado/worker'

/**
 * Estimador de faturamento, mensal (04c §6) → apps/worker
 * (`POST /jobs/radar/estimar-faturamento`): calibra nos clientes que declararam e
 * reestima todo mundo, NESTA ordem e na mesma corrida.
 *
 * Roda no dia 6, um dia depois dos protestos mensais dos clientes (dia 5), e por um
 * motivo: o mês vira, os clientes declaram faturamento novo, e a calibração precisa
 * pegar o mundo já assentado. Rodar antes calibraria contra a foto do mês anterior.
 *
 * Sem cliente com faturamento declarado, o job registra `sem_amostras` e NÃO estima
 * nada. É deliberado: um modelo com coeficientes inventados preencheria a base
 * inteira de números plausíveis e errados — e plausível é o que ninguém questiona.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  const resultado = await dispararEstimadorMensal()

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'radar-estimador', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    job: 'radar-estimador',
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
