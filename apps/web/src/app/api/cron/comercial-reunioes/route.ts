import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararReunioesGoogle } from '@/lib/mercado/worker'

/**
 * As reuniões pendentes vão para o Google Agenda do anfitrião (0201).
 *
 * Este cron é a REDE, não o caminho principal: agendar e editar uma reunião já
 * acordam o job na hora, pela action. Ele existe para o que a action não alcança
 * — o disparo que falhou porque o worker estava reiniciando, a reunião que saiu
 * da fila por falta de conexão e voltou quando alguém conectou o Google, o erro
 * transitório da API que precisa de uma segunda tentativa.
 *
 * De dez em dez minutos: uma reunião que demorou dez minutos para aparecer na
 * agenda do vendedor não atrapalha ninguém; uma que nunca aparece, sim.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararReunioesGoogle()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'comercial-reunioes', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'comercial-reunioes', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
