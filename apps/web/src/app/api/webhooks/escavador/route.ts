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

export async function POST(request: Request): Promise<NextResponse> {
  const cabecalho = request.headers.get('authorization') ?? ''
  const recebido = cabecalho.toLowerCase().startsWith('bearer ') ? cabecalho.slice(7).trim() : cabecalho
  if (!tokenValido(recebido || null)) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  let corpo: PayloadCallback
  try {
    corpo = (await request.json()) as PayloadCallback
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
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
