import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararProtestosClientesMensal } from '@/lib/mercado/worker'

/**
 * Mensal: rotina de protestos dos clientes Onepay → apps/worker
 * (`POST /jobs/radar/protestos-clientes`).
 *
 * O worker consulta protestos NACIONAL da matriz + SPEs ativas do grupo de cada
 * cliente, como um lote automático já aprovado (é política, §5), respeitando o teto
 * de orçamento. Mesmo contrato de auth dos demais crons.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  const resultado = await dispararProtestosClientesMensal()

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'radar-protestos-clientes', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }

  return NextResponse.json({ ok: true, job: 'radar-protestos-clientes', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
