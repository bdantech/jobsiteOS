import { timingSafeEqual, createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
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
 * O segredo do webhook NÃO é o token de envio. O token de envio vive no Vault;
 * publicá-lo num header que qualquer um pode nos fazer comparar batendo na nossa
 * URL entregaria a capacidade de mandar mensagem pelo nosso número. Mesma régua
 * do callback do Escavador.
 *
 * ── O SEGREDO É POR NÚMERO, COM UM FALLBACK GLOBAL ─────────────────────────
 * O Wasender emite um par (access token, webhook secret) POR NÚMERO. O primeiro
 * já era por conta desde a 0045; o segundo virou por conta na 0152, guardado
 * como HASH — ele nunca é lido, só comparado, então guardar o hash basta e é
 * estritamente mais seguro que o Vault.
 *
 * `WASENDER_WEBHOOK_SECRET` sobrevive como fallback e é o caminho de quem tem UM
 * número só: sem ele, ligar o primeiro número exigiria cadastrar a conta antes
 * de o webhook existir. Com dois ou mais, cada um usa o seu — um segredo global
 * faria os webhooks do segundo número levarem 401, e um 401 em webhook não
 * aparece em tela nenhuma: as respostas daquele número simplesmente sumiriam.
 *
 * ── 200 SÓ QUANDO A MENSAGEM FOI ACEITA ────────────────────────────────────
 * O provedor reentrega quando não recebe 200, e a gravação é idempotente pelo id
 * da mensagem — a reentrega é inofensiva. Já o 200 sobre um repasse que falhou é
 * definitivo: não existe varredura que busque no provedor o que perdemos, então
 * a mensagem some para sempre. Entre uma bolha duplicada (que a idempotência
 * impede) e uma resposta de cliente perdida, a escolha não é difícil.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** O fallback global. Falha FECHADA quando a variável não existe. */
function bateComOGlobal(recebido: string): boolean {
  const esperado = process.env.WASENDER_WEBHOOK_SECRET
  if (!esperado) return false
  const a = createHash('sha256').update(recebido).digest()
  const b = createHash('sha256').update(esperado).digest()
  return timingSafeEqual(a, b)
}

/**
 * O segredo de alguma conta ativa. A comparação é feita no BANCO, por hash
 * indexado — trazer os hashes para cá para comparar em JS seria trazer para o
 * runtime da web um material que ele não precisa ter.
 */
async function bateComAlgumaConta(recebido: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { data } = await admin.rpc('app__conta_do_webhook', { p_segredo: recebido })
    return Array.isArray(data) ? data.length > 0 : data !== null
  } catch {
    // Banco fora do ar não pode virar "autorizado". Falha fechada, como o resto.
    return false
  }
}

async function segredoValido(recebido: string): Promise<boolean> {
  // O efeito de um webhook falso aqui é escrever uma mensagem no ledger em nome
  // de um contato real — por isso nada entra sem casar com alguma das duas.
  if (bateComOGlobal(recebido)) return true
  return bateComAlgumaConta(recebido)
}

export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const recebido = request.headers.get('x-webhook-secret') ?? url.searchParams.get('secret')
  if (!recebido || !(await segredoValido(recebido))) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  }

  const r = await repassarWebhookComunicacao('wasender', corpo, recebido)
  if (!r.ok) {
    console.error('[comunicacao] falha ao repassar webhook do Wasender', { code: r.code })
    // 503 para o provedor reentregar. Um worker que voltou em dois minutos
    // recebe a mensagem na segunda tentativa; um 200 aqui a perderia inteira.
    return NextResponse.json({ ok: false }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
