import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararRelogioCobranca } from '@/lib/mercado/worker'

/**
 * Relógio da apólice Atradius (Prompt 07 §6.3) → apps/worker
 * (`POST /jobs/cobranca/relogio-apolice`).
 *
 * 09:00 UTC = 06:00 em São Paulo: o gestor abre o Painel de Cobrança de manhã e o bloco
 * "Relógio da apólice" — a primeira coisa que ele vê — já está com as contagens do dia,
 * e o aviso crítico de D+85 chegou antes do expediente, não no meio dele.
 *
 * TODO DIA, fim de semana incluído: a apólice conta dias corridos, e um D+90 que cai
 * num domingo continua sendo o último dia.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararRelogioCobranca()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'cobranca-relogio', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'cobranca-relogio', disparadoEm: new Date().toISOString() })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
