import { NextResponse } from 'next/server'
import { dispararGmailSync } from '@/lib/mercado/worker'

/**
 * Push do Gmail via Pub/Sub (05A §3.2).
 *
 * ── O PUSH NÃO TRAZ A MENSAGEM ─────────────────────────────────────────────
 * O Gmail Watch avisa "houve mudança na caixa X, o histórico está em Y" e nada
 * mais. Quem busca é o sync — então esta rota é um GATILHO, não um ingestor: ela
 * confere o token, dispara o job e responde. Tentar buscar a mensagem aqui
 * exigiria o access token de outra pessoa dentro de uma rota pública.
 *
 * ── O TOKEN VEM NA QUERY STRING, E É ASSIM QUE O PUB/SUB FUNCIONA ──────────
 * A assinatura de push do Google é um JWT no `Authorization`, e validá-la exige
 * as chaves públicas do Google. Enquanto isso não está ligado, o segredo
 * compartilhado na URL da subscription é o que separa um push nosso de um POST
 * qualquer — e a URL da subscription não é pública.
 *
 * ── 200 SEMPRE ─────────────────────────────────────────────────────────────
 * O Pub/Sub reentrega com backoff exponencial por até 7 dias quando não recebe
 * 2xx. Como a rota só dispara um job idempotente, o reenvio não traz nada de
 * novo — e a fila de reentrega cresceria sozinha.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const esperado = process.env.GOOGLE_PUBSUB_TOKEN
  if (!esperado || url.searchParams.get('token') !== esperado) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  void dispararGmailSync().catch(() => undefined)
  return NextResponse.json({ ok: true })
}
