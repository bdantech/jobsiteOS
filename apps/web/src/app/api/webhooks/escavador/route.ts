import { timingSafeEqual, createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { formatarCnj } from '@jobsiteos/core'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispararCallbacksJuridico } from '@/lib/mercado/worker'

/**
 * Callback do Escavador (08 §3).
 *
 * ── ELA SÓ GRAVA ───────────────────────────────────────────────────────────
 * Buscar a capa, paginar as movimentações e reclassificar as fases leva dezenas de
 * segundos. O Escavador reenvia até 11 vezes com backoff quando não recebe 200 — e
 * o reenvio chegaria com o primeiro processamento ainda rodando. A rota grava a
 * linha em `juridico_callbacks` (chave primária `uuid`, idempotente por construção)
 * e responde; o worker processa a fila.
 *
 * O disparo do job depois da gravação é BEST-EFFORT e não muda a resposta: se o
 * worker estiver fora do ar, a linha continua na fila e a próxima sincronização
 * agendada a drena. Falhar o callback por causa disso pediria um reenvio que não
 * resolveria nada.
 *
 * ── SERVICE ROLE, E ISSO NÃO É ATALHO ──────────────────────────────────────
 * Não há usuário nesta requisição — quem chama é um robô de terceiro. O
 * `juridico_callbacks` tem RLS ligada e NENHUMA policy, então só o service role
 * escreve. A autorização É a validação do token abaixo, e é por isso que ela vem
 * antes de qualquer leitura do corpo.
 *
 * ── DOIS SEGREDOS DIFERENTES ───────────────────────────────────────────────
 * `ESCAVADOR_CALLBACK_TOKEN` (aqui) não é `ESCAVADOR_TOKEN` (o da API, que fica só
 * no worker). Reaproveitar o token de saída como segredo de entrada o publicaria
 * num header que qualquer um pode nos fazer comparar — e é ele que gasta dinheiro.
 *
 * ── O TOKEN TAMBÉM VEM PELA URL, E ISSO NÃO É DESCUIDO ─────────────────────
 * A spec do 08 dizia "header Authorization", e a rota só aceitava isso. Nem todo
 * painel de provedor tem campo para header — o do Wasender não tem, e por isso
 * aquela rota já lia `?secret=`. Exigir um campo que o painel não oferece é a
 * diferença entre "integração configurada" e "o botão de salvar não faz nada".
 *
 * Um segredo na query string aparece em log de proxy, e é por isso que ele é
 * um segredo SÓ DE ENTRADA: quem o roubar consegue nos entregar um callback
 * falso, não gastar nosso crédito. O de saída continua onde estava.
 *
 * ── GET/HEAD RESPONDEM 200 ─────────────────────────────────────────────────
 * Painel que valida a URL antes de salvar costuma bater com GET. Sem isto ele
 * recebia 405 e recusava a URL — e a pessoa ficava clicando em salvar sem
 * entender por quê.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** SHA-256 dos dois lados antes de comparar: `timingSafeEqual` lança em tamanhos
 *  diferentes, e a exceção já vazaria o comprimento do segredo. */
function tokenValido(recebido: string | null): boolean {
  const esperado = process.env.ESCAVADOR_CALLBACK_TOKEN
  // Falha FECHADA: um deploy sem a variável recusa os callbacks em vez de aceitar
  // qualquer um.
  if (!esperado || !recebido) return false
  const a = createHash('sha256').update(recebido).digest()
  const b = createHash('sha256').update(esperado).digest()
  return timingSafeEqual(a, b)
}

interface PayloadCallback {
  uuid?: string
  event?: string
  evento?: string
  numero_cnj?: string
  processo?: { numero_cnj?: string }
}

/**
 * De onde o segredo pode vir.
 *
 * Quando o token é GERADO PELO ESCAVADOR (é o caso: o painel deles emite um), não
 * temos como escolher onde ele chega — a spec do 08 assumiu `Authorization`, mas
 * isso era suposição, não observação. Ler de vários lugares é mais barato que
 * descobrir o certo por tentativa e erro num painel de terceiro.
 *
 * Nenhum destes lugares afrouxa a segurança: a comparação com
 * `ESCAVADOR_CALLBACK_TOKEN` é a mesma, em tempo constante, e continua falhando
 * fechada. O que muda é só ONDE procuramos a string.
 */
const CABECALHOS = [
  'authorization',
  'x-escavador-token',
  'x-callback-token',
  'x-api-token',
  'x-token',
]

function candidatos(request: Request): string[] {
  const out: string[] = []
  for (const nome of CABECALHOS) {
    const v = request.headers.get(nome)
    if (!v) continue
    out.push(v.toLowerCase().startsWith('bearer ') ? v.slice(7).trim() : v.trim())
  }
  const url = new URL(request.url)
  for (const chave of ['token', 'secret']) {
    const v = url.searchParams.get(chave)
    if (v) out.push(v)
  }
  return out.filter(Boolean)
}

function tokenDaRequisicao(request: Request): string | null {
  const achados = candidatos(request)
  // O que CONFERE, não o primeiro que aparece: com vários cabeçalhos presentes,
  // devolver o primeiro faria um `Authorization` de proxy mascarar o token certo.
  return achados.find((t) => tokenValido(t)) ?? achados[0] ?? null
}

/**
 * Quando recusamos, registra os NOMES dos cabeçalhos que vieram — nunca os
 * valores. É o que transforma "o painel não salva" em "eles mandam em
 * `X-Alguma-Coisa` e a gente não lê", sem escrever um segredo no log.
 */
function registrarRecusa(request: Request): void {
  const nomes = [...request.headers.keys()].filter(
    (n) => !['cookie', 'authorization'].includes(n),
  )
  console.warn('[juridico] callback do Escavador recusado', {
    cabecalhos: nomes,
    temAuthorization: request.headers.has('authorization'),
    temQueryToken: new URL(request.url).searchParams.has('token'),
  })
}

/**
 * A verificação da URL feita pelo painel. Responde 200 para dizer "estou aqui e
 * o segredo confere" — e 401 quando não confere, que é a resposta que ajuda a
 * pessoa a descobrir que copiou o token errado.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!tokenValido(tokenDaRequisicao(request))) {
    registrarRecusa(request)
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, servico: 'callback do Escavador' })
}

export async function HEAD(request: Request): Promise<NextResponse> {
  const ok = tokenValido(tokenDaRequisicao(request))
  return new NextResponse(null, { status: ok ? 200 : 401 })
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!tokenValido(tokenDaRequisicao(request))) {
    registrarRecusa(request)
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  let corpo: PayloadCallback
  try {
    corpo = (await request.json()) as PayloadCallback
  } catch {
    // Corpo vazio com token válido é o teste de conexão do painel, não um evento
    // malformado. 400 aqui fazia o painel concluir que a URL não serve.
    return NextResponse.json({ ok: true, ping: true })
  }

  const uuid = typeof corpo.uuid === 'string' && corpo.uuid.length > 0 ? corpo.uuid : null
  if (!uuid) {
    // Sem `uuid` não há idempotência possível. 400 e não 200: aceitar calado faria
    // o mesmo evento ser processado a cada reenvio.
    return NextResponse.json({ erro: 'Callback sem uuid.' }, { status: 400 })
  }

  const cnjBruto = corpo.numero_cnj ?? corpo.processo?.numero_cnj ?? null
  const admin = createAdminClient()

  const { error } = await admin.from('juridico_callbacks').insert({
    uuid,
    evento: corpo.event ?? corpo.evento ?? 'desconhecido',
    numero_cnj: cnjBruto ? formatarCnj(cnjBruto) : null,
    payload: corpo as never,
  })

  if (error) {
    // 23505 = já recebemos este uuid. É o caso NORMAL do reenvio, e a resposta certa
    // continua sendo 200: um erro faria o Escavador reenviar de novo, para sempre.
    if (error.code === '23505') {
      return NextResponse.json({ ok: true, duplicado: true })
    }
    console.error('[juridico] falha ao gravar callback do Escavador', { code: error.code })
    // 500 É intencional aqui: se não conseguimos gravar, QUEREMOS o reenvio. Perder
    // um `novo_processo` é perder uma ação nova contra nós.
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  void dispararCallbacksJuridico().catch(() => undefined)

  return NextResponse.json({ ok: true, duplicado: false })
}
