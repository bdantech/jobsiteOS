import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararMaterializarSeriesReport } from '@/lib/mercado/worker'

/**
 * Diário, de madrugada: a série mensal que sustenta a média de 12 meses do report.
 *
 * Antes do envio, e não depois: a média é a régua de todos os indicadores, e um report
 * gerado sobre uma série de ontem compararia a semana com uma base defasada de um dia — o
 * bastante para o primeiro dia de um mês novo comparar contra o mês que acabou de fechar
 * sem estar fechado.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const r = await dispararMaterializarSeriesReport()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'reports-series', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'reports-series' })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
