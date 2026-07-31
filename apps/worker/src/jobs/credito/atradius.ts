// Caminhos ESPECÍFICOS, nunca o barrel do core: `src/index.js` reexporta o registry,
// que importa `zod-to-json-schema` — dependência que o worker não tem.
import { fetch } from 'undici'
import type {
  BuyerSeguradora,
  DecisaoSeguradora,
  EstagioSeguradora,
  PedidoCobertura,
  ResultadoSeguradora,
  Seguradora,
} from '../../../../../packages/core/src/credito/seguradora.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'

/**
 * Provedor Atradius (04d §4.2), atrás da interface `Seguradora` do core.
 *
 * ── LEIA ANTES DE MEXER ──────────────────────────────────────────────────────────
 * O portal de desenvolvedores da Atradius (api.atradius.com/developers) exige cadastro
 * para liberar os handbooks do Buyer e do Cover API. Sem credenciais não houve como
 * confirmar caminho de rota, nomes de campo nem formato de paginação. O que está aqui é
 * a forma documentada publicamente (OAuth2 client credentials + REST por apólice), e
 * TODA a superfície que pode divergir está isolada em `ROTAS` e nos três `mapear*`
 * abaixo — corrigir contra o handbook real é editar este arquivo e nada mais.
 *
 * A esteira inteira funciona sem isto: sem credencial, `configurada()` devolve false e o
 * envio explica o que falta, em vez de estourar um erro de rede que parece um bug.
 *
 * ── A REGRA DE CUSTO ─────────────────────────────────────────────────────────────
 * `resolverBuyer` PODE SER COBRADO. Ele é chamado em UM lugar: o envio de uma análise,
 * que é um clique humano. Não há busca aberta de buyer neste arquivo, e não há por
 * descuido — a interface do core sequer tem um método para isso.
 */

const ROTAS = {
  token: '/oauth2/token',
  buyerPorIdentificador: (id: string) => `/buyers/v1/search?nationalIdentifier=${encodeURIComponent(id)}`,
  buyer: (buyerId: string) => `/buyers/v1/${encodeURIComponent(buyerId)}`,
  pedirCobertura: (policy: string) => `/cover/v1/policies/${encodeURIComponent(policy)}/requests`,
  decisao: (caseId: string) => `/cover/v1/requests/${encodeURIComponent(caseId)}`,
  portfolio: (policy: string) => `/cover/v1/policies/${encodeURIComponent(policy)}/limits`,
  decisoes: (policy: string) => `/cover/v1/policies/${encodeURIComponent(policy)}/decisions`,
}

interface TokenCache {
  valor: string
  expiraEm: number
}
let token: TokenCache | null = null

function faltaCredencial(): string | null {
  if (!env.ATRADIUS_BASE_URL) return 'ATRADIUS_BASE_URL'
  if (!env.ATRADIUS_CLIENT_ID) return 'ATRADIUS_CLIENT_ID'
  if (!env.ATRADIUS_CLIENT_SECRET) return 'ATRADIUS_CLIENT_SECRET'
  if (!env.ATRADIUS_POLICY_ID) return 'ATRADIUS_POLICY_ID'
  return null
}

function url(rota: string): string {
  return new URL(rota, env.ATRADIUS_BASE_URL as string).toString()
}

/**
 * OAuth2 client-credentials, com o token guardado até 60s antes de vencer. A margem
 * existe porque um token que vence NO MEIO de uma paginação do backfill derruba a
 * corrida inteira em vez de uma página.
 */
async function obterToken(): Promise<ResultadoSeguradora<string>> {
  const falta = faltaCredencial()
  if (falta) return { ok: false, erro: `Credencial ausente: ${falta}.`, recuperavel: false }

  if (token && token.expiraEm > Date.now() + 60_000) return { ok: true, dados: token.valor }

  try {
    const corpo = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.ATRADIUS_CLIENT_ID as string,
      client_secret: env.ATRADIUS_CLIENT_SECRET as string,
    })
    // `fetch` cru, e não `requisitarJson`: o token é form-urlencoded e aquele helper
    // faz JSON.stringify no body, o que transformaria `a=b` na string `"a=b"`.
    const res = await fetch(url(ROTAS.token), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: corpo.toString(),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      return { ok: false, erro: `A Atradius recusou a autenticação (${res.status}).`, recuperavel: res.status >= 500 }
    }
    const resp = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!resp.access_token) return { ok: false, erro: 'A Atradius não devolveu access_token.', recuperavel: true }
    token = { valor: resp.access_token, expiraEm: Date.now() + (resp.expires_in ?? 3600) * 1000 }
    return { ok: true, dados: token.valor }
  } catch (e) {
    // Nunca ecoar o erro cru: numa URL malformada ele carrega host e às vezes a query.
    logger.error({ erro: e instanceof Error ? e.name : 'desconhecido' }, 'Falha ao autenticar na Atradius.')
    return { ok: false, erro: 'Não foi possível autenticar na Atradius.', recuperavel: true }
  }
}

async function chamar<T>(
  rota: string,
  opcoes: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<ResultadoSeguradora<T>> {
  const t = await obterToken()
  if (!t.ok) return t

  try {
    const dados = await requisitarJson<T>(url(rota), {
      method: opcoes.method ?? 'GET',
      headers: {
        authorization: `Bearer ${t.dados}`,
        accept: 'application/json',
        ...(opcoes.body ? { 'content-type': 'application/json' } : {}),
      },
      // Objeto, não string: `requisitarJson` já faz o JSON.stringify.
      ...(opcoes.body ? { body: opcoes.body } : {}),
      timeoutMs: 30_000,
      tentativas: 2,
    })
    return { ok: true, dados }
  } catch (e) {
    const msg = String(e)
    // 4xx é resposta, não falha de transporte: retentar só gasta chamada.
    const recuperavel = !/\b4\d\d\b/.test(msg)
    logger.error({ rota, recuperavel }, 'Chamada à Atradius falhou.')
    return { ok: false, erro: `Atradius respondeu com erro${recuperavel ? ' temporário' : ''}.`, recuperavel }
  }
}

// ─── Mapeamento (a superfície que muda quando o handbook chegar) ────────────

interface BuyerBruto {
  buyerId?: string
  id?: string
  nationalIdentifier?: string
  name?: string
  rating?: string
  buyerRating?: string
}

interface DecisaoBruta {
  requestId?: string
  caseId?: string
  id?: string
  buyerId?: string
  status?: string
  decision?: string
  approvedAmount?: number
  amount?: number
  currency?: string
  validUntil?: string
  expiryDate?: string
  decisionDate?: string
  reason?: string
  buyerRating?: string
}

function soDigitos(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '')
  return d.length === 14 ? d : null
}

function mapearBuyer(b: BuyerBruto | null | undefined): BuyerSeguradora | null {
  if (!b) return null
  const id = b.buyerId ?? b.id
  if (!id) return null
  return {
    buyer_id: String(id),
    // O identificador nacional é o elo com a nossa base. Sem os 14 dígitos ele vira
    // null e o backfill manda a linha para revisão manual — em vez de casar por nome,
    // que é como duas construtoras homônimas viram a mesma empresa.
    identificador_nacional: soDigitos(b.nationalIdentifier),
    nome: b.name ?? null,
    rating: b.rating ?? b.buyerRating ?? null,
  }
}

/**
 * O vocabulário da seguradora → o nosso. O default é `em_analise`, e não uma exceção:
 * um status que a Atradius inventar amanhã não pode travar o poll de todas as outras.
 */
function mapearEstagio(status: string | undefined): EstagioSeguradora {
  const s = (status ?? '').toLowerCase()
  if (/approved.*part|partial/.test(s)) return 'aprovada_parcial'
  if (/approv|granted|accept/.test(s)) return 'aprovada'
  if (/refus|declin|reject|denied/.test(s)) return 'negada'
  if (/expir/.test(s)) return 'expirada'
  if (/cancel|withdraw/.test(s)) return 'cancelada'
  return 'em_analise'
}

function mapearDecisao(d: DecisaoBruta | null | undefined): DecisaoSeguradora | null {
  if (!d) return null
  const caseId = d.requestId ?? d.caseId ?? d.id
  if (!caseId || !d.buyerId) return null
  const bruto = d.approvedAmount ?? d.amount ?? null
  return {
    case_id: String(caseId),
    buyer_id: String(d.buyerId),
    estagio: mapearEstagio(d.status ?? d.decision),
    limite_aprovado: typeof bruto === 'number' ? bruto : null,
    moeda: d.currency ?? 'BRL',
    expira_em: (d.validUntil ?? d.expiryDate ?? null)?.slice(0, 10) ?? null,
    decidida_em: d.decisionDate ?? null,
    motivo: d.reason ?? null,
    rating: d.buyerRating ?? null,
  }
}

interface PaginaBruta<T> {
  items?: T[]
  content?: T[]
  data?: T[]
  next?: string
  nextCursor?: string
}

function mapearPagina(p: PaginaBruta<DecisaoBruta>): {
  itens: DecisaoSeguradora[]
  proximoCursor: string | null
} {
  const brutos = p.items ?? p.content ?? p.data ?? []
  return {
    itens: brutos.map(mapearDecisao).filter((d): d is DecisaoSeguradora => d !== null),
    proximoCursor: p.next ?? p.nextCursor ?? null,
  }
}

// ─── O provedor ─────────────────────────────────────────────────────────────

export const atradius: Seguradora = {
  id: 'atradius',
  nome: 'Atradius',

  configurada: () => faltaCredencial() === null,

  async resolverBuyer(cnpj) {
    const r = await chamar<PaginaBruta<BuyerBruto> | BuyerBruto>(
      ROTAS.buyerPorIdentificador(cnpj),
    )
    if (!r.ok) return r
    const corpo = r.dados as PaginaBruta<BuyerBruto> & BuyerBruto
    const lista = corpo.items ?? corpo.content ?? corpo.data
    const primeiro = Array.isArray(lista) ? lista[0] : corpo
    return { ok: true, dados: mapearBuyer(primeiro) }
  },

  async detalharBuyer(buyerId) {
    const r = await chamar<BuyerBruto>(ROTAS.buyer(buyerId))
    if (!r.ok) return r
    return { ok: true, dados: mapearBuyer(r.dados) }
  },

  async pedirCobertura(pedido: PedidoCobertura) {
    const r = await chamar<{ requestId?: string; caseId?: string; id?: string }>(
      ROTAS.pedirCobertura(env.ATRADIUS_POLICY_ID as string),
      {
        method: 'POST',
        body: {
          buyerId: pedido.buyer_id,
          requestedAmount: pedido.limite_solicitado,
          currency: pedido.moeda,
          externalReference: pedido.referencia_externa,
        },
      },
    )
    if (!r.ok) return r
    const caseId = r.dados.requestId ?? r.dados.caseId ?? r.dados.id
    if (!caseId) {
      return { ok: false, erro: 'A Atradius aceitou o pedido mas não devolveu um id de caso.', recuperavel: false }
    }
    return { ok: true, dados: { case_id: String(caseId) } }
  },

  async consultarDecisao(caseId) {
    const r = await chamar<DecisaoBruta>(ROTAS.decisao(caseId))
    if (!r.ok) return r
    return { ok: true, dados: mapearDecisao(r.dados) }
  },

  async listarPortfolio(cursor) {
    const base = ROTAS.portfolio(env.ATRADIUS_POLICY_ID as string)
    const r = await chamar<PaginaBruta<DecisaoBruta>>(cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base)
    if (!r.ok) return r
    return { ok: true, dados: mapearPagina(r.dados) }
  },

  async listarDecisoes(desde, cursor) {
    const base = ROTAS.decisoes(env.ATRADIUS_POLICY_ID as string)
    const qs = new URLSearchParams()
    if (desde) qs.set('since', desde)
    if (cursor) qs.set('cursor', cursor)
    const rota = qs.toString() ? `${base}?${qs.toString()}` : base
    const r = await chamar<PaginaBruta<DecisaoBruta>>(rota)
    if (!r.ok) return r
    return { ok: true, dados: mapearPagina(r.dados) }
  },
}
