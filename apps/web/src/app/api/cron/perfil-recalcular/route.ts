import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararPerfilRecalcular } from '@/lib/mercado/worker'

/**
 * Perfil de Quem Opera (04f), mensal → apps/worker (`POST /jobs/perfil/recalcular`).
 *
 * Roda no dia 8, DEPOIS do estimador de faturamento (dia 6) e do Crédito (dia 7),
 * e a ordem é uma dependência real: o perfil contrasta `faturamento_estimado` e
 * `score_credito`, então rodar antes compararia as coortes usando os números do
 * mês passado — e gravaria isso como snapshot, virando história errada.
 *
 * O job não aplica nada. Ele escreve um snapshot por comparação; quem muda régua
 * é gente, pelo editor, com preview de impacto.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararPerfilRecalcular()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'perfil-recalcular', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({
    ok: true,
    job: 'perfil-recalcular',
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
