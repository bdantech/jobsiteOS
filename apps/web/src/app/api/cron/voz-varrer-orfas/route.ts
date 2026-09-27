import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararVarrerOrfas } from '@/lib/mercado/worker'

/**
 * A ligação órfã (Prompt 09 §1.5) → `POST /jobs/voz/varrer-orfas`.
 *
 * De dez em dez minutos no horário em que a Ana liga: `enviada` sem resultado há mais de
 * `voz_timeout_minutos` vira falha, libera a nota e acorda o mandato.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararVarrerOrfas()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'voz-varrer-orfas', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'voz-varrer-orfas', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
