import { timingSafeEqual, createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { repassarWebhookComunicacao } from '@/lib/mercado/worker'

/**
 * Webhook de eventos do Resend (05A §3.2): entrega, abertura, bounce e
 * reclamação.
 *
 * Os dois últimos NÃO são apenas status: hard bounce e "isto é spam" viram linha
 * em `supressao` do lado do worker. É por isso que a autenticação aqui não é
 * opcional — um POST forjado nesta rota suprime o e-mail de quem o atacante
 * quiser.
 *
 * Autentica e repassa, pelo mesmo motivo da rota do Wasender: uma implementação
 * só, alcançável pelas duas URLs que o painel do provedor aceita.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function segredoValido(recebido: string): boolean {
  const esperado = process.env.RESEND_WEBHOOK_SECRET
  if (!esperado) return false
  const a = createHash('sha256').update(recebido).digest()
  const b = createHash('sha256').update(esperado).digest()
  return timingSafeEqual(a, b)
}

export async function POST(request: Request): Promise<NextResponse> {
  const recebido =
    request.headers.get('x-webhook-secret') ?? request.headers.get('svix-signature')
  if (!recebido || !segredoValido(recebido)) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  }

  const r = await repassarWebhookComunicacao('resend', corpo, recebido)
  if (!r.ok) {
    console.error('[comunicacao] falha ao repassar webhook do Resend', { code: r.code })
    // 503 para o Resend reentregar: um bounce perdido é um endereço morto que
    // continua recebendo, e é a supressão que este webhook existe para escrever.
    return NextResponse.json({ ok: false }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
