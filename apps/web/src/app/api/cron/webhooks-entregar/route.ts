import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararEntregarWebhooks } from '@/lib/mercado/worker'

/**
 * A fila de webhooks de saída (04n §3.4).
 *
 * De cinco em cinco minutos: o backoff da primeira tentativa é de um minuto, e um
 * cron mais raro faria a menor espera do backoff virar ficção. A API também cutuca
 * a fila ao enfileirar, então o caminho feliz não espera pelo cron — ele existe
 * para as REtentativas, que são justamente as que ninguém está olhando.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararEntregarWebhooks()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'webhooks-entregar', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'webhooks-entregar', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
