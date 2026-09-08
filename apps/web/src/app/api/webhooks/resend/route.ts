import { createHmac, timingSafeEqual } from 'node:crypto'
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
 *
 * ── POR QUE A ASSINATURA, E NÃO MAIS UM SEGREDO NO HEADER ──────────────────
 * Isto comparava `x-webhook-secret` (ou, pior, `svix-signature`) com uma variável
 * de ambiente. Nenhum dos dois podia funcionar: o Resend assina com Svix e não
 * oferece campo para header customizado, e o `svix-signature` carrega um HMAC
 * calculado sobre CADA corpo — comparar isso com um segredo fixo nunca casa. Na
 * prática a rota devolveria 401 a todo evento, e os bounces nunca chegariam à
 * supressão.
 *
 * Agora ela verifica a assinatura de verdade, no formato Standard Webhooks que o
 * Svix implementa. `RESEND_WEBHOOK_SECRET` passa a ser o SIGNING SECRET que o
 * painel do Resend mostra (`whsec_…`) — copiado de lá, não inventado aqui.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Fora desta janela, um evento reaproveitado por um atacante deixa de valer. */
const TOLERANCIA_SEGUNDOS = 5 * 60

function comparar(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Verificação Standard Webhooks: HMAC-SHA256 sobre `{id}.{timestamp}.{corpo}`,
 * com a chave sendo o segredo em base64 (sem o prefixo `whsec_`).
 *
 * O corpo entra CRU, byte a byte. Reserializar o JSON parseado mudaria espaços e
 * ordem de chaves e a assinatura deixaria de bater — é por isso que a rota lê
 * `text()` e só faz `JSON.parse` depois de autorizar.
 */
function assinaturaValida(corpoCru: string, headers: Headers): boolean {
  const segredo = process.env.RESEND_WEBHOOK_SECRET
  const id = headers.get('svix-id')
  const timestamp = headers.get('svix-timestamp')
  const assinaturas = headers.get('svix-signature')
  if (!segredo || !id || !timestamp || !assinaturas) return false

  // Replay: sem a janela, um evento capturado uma vez vale para sempre.
  const emSegundos = Number(timestamp)
  if (!Number.isFinite(emSegundos)) return false
  if (Math.abs(Date.now() / 1000 - emSegundos) > TOLERANCIA_SEGUNDOS) return false

  const chave = Buffer.from(segredo.replace(/^whsec_/, ''), 'base64')
  const esperado = createHmac('sha256', chave)
    .update(`${id}.${timestamp}.${corpoCru}`)
    .digest()

  /*
   * O header traz uma LISTA separada por espaço — `v1,<b64> v1,<b64>` — porque
   * durante uma rotação de segredo o Svix assina com os dois. Basta uma casar, e
   * versões que não sejam `v1` são ignoradas em vez de recusadas.
   */
  return assinaturas.split(' ').some((parte) => {
    const [versao, valor] = parte.split(',')
    if (versao !== 'v1' || !valor) return false
    try {
      return comparar(esperado, Buffer.from(valor, 'base64'))
    } catch {
      return false
    }
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  const corpoCru = await request.text()

  if (!assinaturaValida(corpoCru, request.headers)) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  let corpo: unknown
  try {
    corpo = JSON.parse(corpoCru)
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  }

  /*
   * O worker é chamado com o WORKER_SECRET pelo `repassarWebhookComunicacao` — o
   * salto Vercel→Railway é interno e autenticado por ele. O segredo do Resend
   * segue junto só para a rota do worker aceitar quem chega por lá; quem provou a
   * autenticidade do evento foi a assinatura verificada acima.
   */
  const r = await repassarWebhookComunicacao(
    'resend',
    corpo,
    process.env.RESEND_WEBHOOK_SECRET ?? '',
  )
  if (!r.ok) {
    console.error('[comunicacao] falha ao repassar webhook do Resend', { code: r.code })
    // 503 para o Resend reentregar: um bounce perdido é um endereço morto que
    // continua recebendo, e é a supressão que este webhook existe para escrever.
    return NextResponse.json({ ok: false }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
