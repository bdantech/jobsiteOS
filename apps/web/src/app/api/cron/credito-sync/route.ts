import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararSyncAtradius } from '@/lib/mercado/worker'

/**
 * Diário do Crédito (04d §4.3/§4.4) → apps/worker (`POST /jobs/credito/sync`): sync do
 * que já está na apólice, poll das decisões abertas e expiração das aprovações vencidas.
 *
 * O sync NUNCA descobre buyer novo — ele lê decisões de casos que já passaram por aqui.
 * Buyer novo só entra pelo envio da esteira, que é ação humana e pode ser cobrada.
 *
 * A expiração roda mesmo sem seguradora configurada: a data de validade é NOSSA, e uma
 * aprovação vencida contando como vigente valeria pontos no scorecard que ela não tem mais.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararSyncAtradius()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'credito-sync', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'credito-sync', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
