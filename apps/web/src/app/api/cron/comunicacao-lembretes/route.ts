import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararLembretesReuniao } from '@/lib/mercado/worker'

/**
 * Reuniões (05A §5): confirmação, lembrete D-1, lembrete H-1 e convite para remarcar depois de um no-show.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararLembretesReuniao()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'comunicacao-lembretes', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'comunicacao-lembretes', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
