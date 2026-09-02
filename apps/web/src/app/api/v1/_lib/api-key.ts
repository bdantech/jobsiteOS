import { createHash, randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * A porta da API pública (04n §1): chave, escopo, rate limit e trilha.
 *
 * ── SERVICE ROLE, E POR QUÊ ────────────────────────────────────────────────
 * Quem chama não é um usuário: não há sessão, não há perfil, não há RLS que
 * signifique alguma coisa para ele. A autorização inteira é a chave e o escopo
 * dela, conferidos aqui — e é por isso que este arquivo é o único lugar do
 * caminho da API que decide quem entra. Uma rota que esqueça de chamar
 * `autenticar()` fica aberta, então nenhuma rota monta a resposta sozinha: todas
 * passam por `responder()`, que também é quem grava o log.
 *
 * ── A CHAVE SÓ EXISTE UMA VEZ ──────────────────────────────────────────────
 * `gerarChave()` devolve o segredo em claro para ser mostrado na criação e nunca
 * mais; o banco guarda o SHA-256. Não existe caminho que a reconstrua — nem para
 * o service role —, e é isso que torna "perdi a chave" uma rotação em vez de uma
 * consulta.
 */

export interface ContextoApi {
  keyId: string
  escopos: string[]
  nome: string
}

const PREFIXO_CHAVE = 'jos_'

export function hashChave(chave: string): string {
  return createHash('sha256').update(chave, 'utf8').digest('hex')
}

/** Gera o par (segredo em claro, o que vai para o banco). */
export function gerarChave(): { chave: string; hash: string; prefixo: string } {
  const chave = `${PREFIXO_CHAVE}${randomBytes(32).toString('base64url')}`
  return { chave, hash: hashChave(chave), prefixo: chave.slice(0, 12) }
}

export interface FalhaApi {
  status: number
  codigo: string
  mensagem: string
  detalhes?: unknown
}

/**
 * O corpo de erro é sempre a mesma forma. Um integrador que precisa de um `if`
 * por rota para achar a mensagem desiste de tratar erro — e passa a tratar tudo
 * como 500.
 */
export function erroApi(f: FalhaApi): NextResponse {
  return NextResponse.json(
    { erro: { codigo: f.codigo, mensagem: f.mensagem, detalhes: f.detalhes ?? null } },
    { status: f.status },
  )
}

interface ConfigApi {
  rate_limit_por_minuto: number
  payload_max_kb: number
  documento_max_mb: number
}

const CONFIG_PADRAO: ConfigApi = {
  rate_limit_por_minuto: 60,
  payload_max_kb: 512,
  documento_max_mb: 20,
}

export async function lerConfigApi(): Promise<ConfigApi> {
  const { data } = await createAdminClient()
    .from('credito_config')
    .select('valor')
    .eq('chave', 'api')
    .maybeSingle()
  return { ...CONFIG_PADRAO, ...((data?.valor as Partial<ConfigApi> | null) ?? {}) }
}

/**
 * Autentica pela chave e confere o escopo pedido.
 *
 * O rate limit é contado sobre `api_requests_log`, que já existe para a
 * observabilidade — uma segunda estrutura só para contar seria um segundo lugar
 * onde o número pode divergir do que o painel mostra. É uma janela deslizante de
 * um minuto: aproximada o suficiente para o propósito, que é impedir laço
 * acidental, não policiar tráfego legítimo.
 */
export async function autenticar(
  request: Request,
  escopo: string,
): Promise<{ ok: true; ctx: ContextoApi } | { ok: false; falha: FalhaApi }> {
  const cabecalho = request.headers.get('authorization') ?? ''
  const chave = cabecalho.toLowerCase().startsWith('bearer ') ? cabecalho.slice(7).trim() : ''
  if (!chave) {
    return {
      ok: false,
      falha: {
        status: 401,
        codigo: 'sem_credencial',
        mensagem: 'Envie a chave em Authorization: Bearer {chave}.',
      },
    }
  }

  const admin = createAdminClient()
  const { data: key } = await admin
    .from('api_keys')
    .select('id, nome, escopos, ativa')
    .eq('key_hash', hashChave(chave))
    .maybeSingle()

  // Chave inexistente e chave revogada dão a MESMA resposta: distinguir as duas
  // conta a quem está tentando se ele acertou o segredo de uma chave que existiu.
  if (!key || !key.ativa) {
    return { ok: false, falha: { status: 401, codigo: 'credencial_invalida', mensagem: 'Chave inválida ou revogada.' } }
  }

  if (!key.escopos.includes(escopo)) {
    return {
      ok: false,
      falha: {
        status: 403,
        codigo: 'escopo_insuficiente',
        mensagem: `Esta chave não tem o escopo "${escopo}".`,
      },
    }
  }

  const cfg = await lerConfigApi()
  const desde = new Date(Date.now() - 60_000).toISOString()
  const { count } = await admin
    .from('api_requests_log')
    .select('id', { count: 'exact', head: true })
    .eq('api_key_id', key.id)
    .gte('criado_em', desde)

  if ((count ?? 0) >= cfg.rate_limit_por_minuto) {
    return {
      ok: false,
      falha: {
        status: 429,
        codigo: 'rate_limit',
        mensagem: `Limite de ${cfg.rate_limit_por_minuto} requisições por minuto atingido.`,
      },
    }
  }

  // Best-effort: falhar aqui não pode derrubar uma requisição válida.
  void admin.from('api_keys').update({ ultimo_uso_em: new Date().toISOString() }).eq('id', key.id)

  return { ok: true, ctx: { keyId: key.id, escopos: key.escopos, nome: key.nome } }
}

/** Grava a trilha (§5). Chamado por `responder()`, nunca pelas rotas direto. */
export async function registrarRequisicao(dados: {
  keyId: string | null
  rota: string
  metodo: string
  status: number
  duracaoMs: number
  idempotencyKey?: string | null
  erro?: string | null
}): Promise<void> {
  try {
    await createAdminClient().from('api_requests_log').insert({
      api_key_id: dados.keyId,
      rota: dados.rota,
      metodo: dados.metodo,
      status_http: dados.status,
      duracao_ms: dados.duracaoMs,
      idempotency_key: dados.idempotencyKey ?? null,
      // O log guarda a MENSAGEM do erro, nunca o corpo da requisição: o payload
      // traz CNPJ, contato e às vezes documento, e uma tabela de observabilidade
      // não é lugar para nada disso (§7, "logs sem conteúdo sensível").
      erro: dados.erro ? dados.erro.slice(0, 500) : null,
    })
  } catch {
    // Observabilidade não derruba tráfego.
  }
}

// ─── Idempotência ───────────────────────────────────────────────────────────

export async function respostaIdempotente(
  keyId: string,
  chave: string,
): Promise<{ status: number; corpo: unknown } | null> {
  const { data } = await createAdminClient()
    .from('api_idempotencia')
    .select('status_http, resposta')
    .eq('api_key_id', keyId)
    .eq('chave', chave)
    .maybeSingle()
  if (!data) return null
  return { status: data.status_http, corpo: data.resposta }
}

export async function guardarIdempotencia(
  keyId: string,
  chave: string,
  rota: string,
  status: number,
  corpo: unknown,
): Promise<void> {
  await createAdminClient()
    .from('api_idempotencia')
    .upsert(
      { api_key_id: keyId, chave, rota, status_http: status, resposta: corpo as never },
      { onConflict: 'api_key_id,chave' },
    )
}
