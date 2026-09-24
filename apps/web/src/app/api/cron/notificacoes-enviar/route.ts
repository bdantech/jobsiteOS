import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararEnviarNotificacoes } from '@/lib/mercado/worker'

/**
 * A fila de push e e-mail dos avisos (0262), de cinco em cinco minutos.
 *
 * Quem emite pelo Node entrega o próprio push na hora; este cron existe para o que
 * nasce no banco (o trigger de `empresa_eventos` não fala HTTP) e para o que o
 * horário de silêncio segurou até de manhã.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararEnviarNotificacoes()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'notificacoes-enviar', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'notificacoes-enviar', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
