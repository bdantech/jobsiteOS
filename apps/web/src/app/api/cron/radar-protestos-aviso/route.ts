import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararAvisoCustoProtestos } from '@/lib/mercado/worker'

/**
 * O aviso de custo da rotina mensal de protestos → apps/worker
 * (`POST /jobs/radar/protestos-aviso`).
 *
 * Agendado nos dias 28–31, mas quem decide se notifica é o worker: ele só manda no
 * ÚLTIMO dia do mês, que é sempre exatamente cinco dias antes da rodada do dia 5 —
 * em fevereiro como em março. A expressão de cron não sabe dizer "último dia", e um
 * cron marcado no dia 30 nunca dispararia em fevereiro, que é o tipo de furo que
 * ninguém percebe porque um aviso que não chega não gera erro.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  const resultado = await dispararAvisoCustoProtestos()

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'radar-protestos-aviso', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    job: 'radar-protestos-aviso',
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
