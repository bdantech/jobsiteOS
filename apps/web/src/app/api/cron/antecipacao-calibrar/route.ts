import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararCalibrarEconomia } from '@/lib/mercado/worker'

/**
 * Calibração da economia com a carteira real (04e §5), mensal → apps/worker
 * (`POST /jobs/antecipacao/calibrar`).
 *
 * Roda no dia 5, ANTES do estimador de faturamento (dia 6) e do Crédito (dia 7).
 * A ordem não muda nada tecnicamente — este job só MEDE — mas é a ordem em que
 * alguém precisa ver o número: se a taxa real da carteira divergiu da
 * configurada, é bom saber disso antes de o mês inteiro de potencial de crédito
 * ser recalculado em cima da constante velha.
 *
 * Aplicar continua sendo um botão em /antecipacao/config. Trocar sozinha a
 * constante que multiplica a receita esperada de todo o funil, em cima de um mês
 * atípico, é o tipo de automação que ninguém pede e todo mundo descobre tarde.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararCalibrarEconomia()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'antecipacao-calibrar', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({
    ok: true,
    job: 'antecipacao-calibrar',
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
