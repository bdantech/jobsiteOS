import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararAntecipacaoDiario } from '@/lib/mercado/worker'

/**
 * O job diário da Antecipação → apps/worker (`POST /jobs/antecipacao/diario`):
 * limpa supressões vencidas, consome a fila de lookup cadastral, reclassifica com
 * expiração e regenera a outbox.
 *
 * É o job que impede o funil de apodrecer: as notas não mudam, o calendário muda.
 * Sem ele, em duas semanas o Kanban está cheio de nota que não dá mais para
 * operar, ordenada por uma receita esperada que também está errada.
 *
 * Roda de madrugada, ANTES do primeiro sync do dia (02:30 BRT / 05:30 UTC), para
 * que o vendedor abra o app já com o funil limpo.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  const resultado = await dispararAntecipacaoDiario()

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'antecipacao-diario', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    job: 'antecipacao-diario',
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
