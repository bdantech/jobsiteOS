import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararAceitesSdr } from '@/lib/mercado/worker'

/**
 * De hora em hora: abre a fila de aceite das reuniões realizadas, expira COMO ACEITA o
 * que passou do SLA e lança o que foi aceito.
 *
 * De hora em hora, e não uma vez ao dia, porque o SLA é contado em horas — um relógio
 * mais grosso que a unidade que ele mede erra sistematicamente para o mesmo lado.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const r = await dispararAceitesSdr()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'comercial-sdr-aceites', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({
    ok: true,
    job: 'comercial-sdr-aceites',
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
