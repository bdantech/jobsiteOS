import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararComissoesDiario } from '@/lib/mercado/worker'

/**
 * Diário do motor de comissões v2 (04k): titularidades automáticas, backfill das cessões
 * convertidas e — só quando hoje É o último dia útil — o fechamento da competência.
 *
 * Roda às 23h50 de São Paulo (02h50 UTC do dia seguinte). Quem decide se é dia de fechar
 * é o job: "último dia útil" não é uma expressão que o cron saiba dizer, e um cron marcado
 * no dia 30 nunca dispararia em fevereiro.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const r = await dispararComissoesDiario()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'comercial-comissoes-v2', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({
    ok: true,
    job: 'comercial-comissoes-v2',
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
