import { timingSafeEqual, createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { repassarWebhookComunicacao } from '@/lib/mercado/worker'

/**
 * Webhook de recebimento do WhatsApp (05A §3.1).
 *
 * ── ELA AUTENTICA E REPASSA ────────────────────────────────────────────────
 * A gravação no ledger, a resolução do contato e a fila de identificação vivem no
 * worker, e a MESMA rota existe lá. A URL cadastrada no painel do provedor pode
 * apontar para qualquer uma das duas; ter duas implementações do mesmo efeito
 * seria ter duas que divergem na primeira correção feita em só uma.
 *
 * ── DOIS SEGREDOS DIFERENTES ───────────────────────────────────────────────
 * `WASENDER_WEBHOOK_SECRET` (aqui) NÃO é o token de envio. O token de envio é por
 * CONTA e vive no Vault; publicá-lo num header que qualquer um pode nos fazer
 * comparar batendo na nossa URL entregaria a capacidade de mandar mensagem pelo
 * nosso número. Mesma régua do callback do Escavador.
 *
 * ── 200 QUASE SEMPRE ───────────────────────────────────────────────────────
 * O provedor reentrega quando não recebe 200 rápido, e a gravação é idempotente
 * pelo id da mensagem. Responder erro provocaria uma tempestade de reenvio que a
 * idempotência já tornaria inofensiva — e inútil.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function segredoValido(recebido: string | null): boolean {
  const esperado = process.env.WASENDER_WEBHOOK_SECRET
  // Falha FECHADA: sem a variável, nenhum webhook entra. O efeito de um webhook
  // falso aqui é escrever uma mensagem no ledger em nome de um contato real.
  if (!esperado || !recebido) return false
  const a = createHash('sha256').update(recebido).digest()
  const b = createHash('sha256').update(esperado).digest()
  return timingSafeEqual(a, b)
}

export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const recebido = request.headers.get('x-webhook-secret') ?? url.searchParams.get('secret')
  if (!segredoValido(recebido)) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  }

  const r = await repassarWebhookComunicacao('wasender', corpo)
  if (!r.ok) {
    console.error('[comunicacao] falha ao repassar webhook do Wasender', { code: r.code })
    // 200 mesmo assim: o reenvio não resolveria um worker fora do ar, e a
    // mensagem perdida é recuperada pela varredura do provedor.
    return NextResponse.json({ ok: false })
  }
  return NextResponse.json({ ok: true })
}
