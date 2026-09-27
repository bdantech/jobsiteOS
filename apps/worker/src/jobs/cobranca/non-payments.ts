import type { ResultadoSeguradora } from '../../../../../packages/core/src/credito/seguradora.js'
import { apoliceVigente, chamar } from '../credito/atradius.js'
import { env } from '../../env.js'

/**
 * Non-Payments API da Atradius (Prompt 07 §7.4) — o modo `api` do envio à seguradora.
 *
 * ── NADA AQUI FOI CONFIRMADO CONTRA A API REAL ──────────────────────────────
 * O acesso é liberado por entitlement por apólice e ainda não o temos (tarefa externa:
 * "solicitar acesso em api.atradius.com/register-now, apólice 9000373_SUSEP"). Caminhos,
 * nomes de campo e o formato da resposta abaixo seguem a forma pública da família de
 * APIs (mesmo OAuth, mesmo gateway, envelope `data`) e o vocabulário da apólice — e
 * NADA mais. Quando o handbook chegar, corrigir é editar ESTE arquivo: o caminho base
 * vem de `ATRADIUS_NON_PAYMENTS_PATH`, e o mapeamento está todo em `payload*`.
 *
 * ── LIGAR A API NÃO MUDA O DOSSIÊ ───────────────────────────────────────────
 * O payload é montado das MESMAS estruturas do modo manual (os títulos do sinistro, as
 * datas do relógio, o ZIP do dossiê). Muda o transporte, não o conteúdo.
 *
 * ── O PRAZO NUNCA DEPENDE DISTO ─────────────────────────────────────────────
 * Qualquer falha devolve `ok: false` e quem chama manda a pessoa para o modo manual. Um
 * prazo de apólice não pode morrer por 500.
 *
 * Reusa `chamar` do cliente das Buyer/Cover APIs (jobs/credito/atradius.ts): token,
 * ambiente sandbox/produção, correlação e tratamento de erro são os mesmos.
 */

/** Liga só com a flag E a config: um dos dois sozinho não basta. */
export function nonPaymentsHabilitada(): boolean {
  return env.ATRADIUS_NON_PAYMENTS_ENABLED === 'true'
}

const base = () => (env.ATRADIUS_NON_PAYMENTS_PATH ?? '/credit-insurance/non-payments/v1').replace(/\/$/, '')

export interface TituloNaoPago {
  numero: string
  nf_chave_acesso: string | null
  emissao: string | null
  vencimento: string
  valor_face: number
  valor_em_aberto: number
}

export interface AvisoNaoPagamento {
  /** O código do nosso sinistro, que vai como referência do cliente. */
  referencia: string
  comprador_cnpj: string
  comprador_nome: string
  causa: 'mora_prolongada' | 'insolvencia'
  data_perda: string
  titulos: TituloNaoPago[]
  contato: { nome: string | null; email: string | null }
  observacao?: string | null
}

export interface ResultadoNonPayments {
  protocolo: string | null
  bruto: unknown
}

/** NÃO VERIFICADO: forma presumida do corpo do aviso de não pagamento. */
function payloadAviso(policyId: string, a: AvisoNaoPagamento): Record<string, unknown> {
  const total = a.titulos.reduce((s, t) => s + t.valor_em_aberto, 0)
  return {
    policyId,
    customerReference: a.referencia.slice(0, 25),
    buyer: { countryCode: 'BR', uid: a.comprador_cnpj, name: a.comprador_nome },
    reason: a.causa === 'insolvencia' ? 'INSOLVENCY' : 'PROTRACTED_DEFAULT',
    dateOfLoss: a.data_perda,
    currency: 'BRL',
    totalOverdueAmount: Math.round(total * 100) / 100,
    invoices: a.titulos.map((t) => ({
      invoiceNumber: t.numero,
      invoiceReference: t.nf_chave_acesso,
      invoiceDate: t.emissao,
      dueDate: t.vencimento,
      invoiceAmount: t.valor_face,
      outstandingAmount: t.valor_em_aberto,
    })),
    contact: { name: a.contato.nome, email: a.contato.email },
    comments: a.observacao ?? undefined,
  }
}

/** O protocolo da resposta, em qualquer um dos nomes plausíveis. NÃO VERIFICADO. */
function protocoloDe(corpo: unknown): string | null {
  const alvos: unknown[] = []
  if (corpo && typeof corpo === 'object') {
    const d = (corpo as { data?: unknown }).data
    if (Array.isArray(d)) alvos.push(...d)
    else if (d) alvos.push(d)
    alvos.push(corpo)
  }
  for (const a of alvos) {
    if (!a || typeof a !== 'object') continue
    const o = a as Record<string, unknown>
    const v = o.nonPaymentId ?? o.claimId ?? o.caseId ?? o.id ?? o.reference
    if (typeof v === 'string' || typeof v === 'number') return String(v)
  }
  return null
}

async function policyId(): Promise<ResultadoSeguradora<string>> {
  const a = await apoliceVigente()
  return a.ok ? { ok: true, dados: a.dados.policy_id } : a
}

/** cl. 18500.01 — o aviso de inadimplemento (o D+90). */
export async function notificarNaoPagamento(a: AvisoNaoPagamento): Promise<ResultadoSeguradora<ResultadoNonPayments>> {
  const p = await policyId()
  if (!p.ok) return p
  const r = await chamar<unknown>(`${base()}/non-payments`, { method: 'POST', body: payloadAviso(p.dados, a) })
  return r.ok ? { ok: true, dados: { protocolo: protocoloDe(r.dados), bruto: r.dados } } : r
}

/** cl. 22100.20 — o sinistro completo, sobre um aviso já feito (quando houver protocolo). */
export async function enviarSinistro(
  a: AvisoNaoPagamento,
  protocoloAviso: string | null,
): Promise<ResultadoSeguradora<ResultadoNonPayments>> {
  const p = await policyId()
  if (!p.ok) return p
  const caminho = protocoloAviso
    ? `${base()}/non-payments/${encodeURIComponent(protocoloAviso)}/claims`
    : `${base()}/claims`
  const r = await chamar<unknown>(caminho, { method: 'POST', body: payloadAviso(p.dados, a) })
  return r.ok ? { ok: true, dados: { protocolo: protocoloDe(r.dados) ?? protocoloAviso, bruto: r.dados } } : r
}

/** Acompanhamento do caso. NÃO VERIFICADO: o vocabulário de status é desconhecido. */
export async function consultarStatus(protocolo: string): Promise<ResultadoSeguradora<unknown>> {
  return chamar<unknown>(`${base()}/non-payments/${encodeURIComponent(protocolo)}`)
}

/**
 * Documentos do sinistro. NÃO VERIFICADO — e a hipótese mais frágil do arquivo: na Cover
 * API a Atradius NÃO aceitou documento (ver ROTAS em credito/atradius.ts), e aqui vai o
 * ZIP em base64 num JSON porque `chamar` só fala JSON. Se o handbook pedir multipart, é
 * aqui que muda.
 */
export async function enviarDocumentos(
  protocolo: string,
  arquivo: { nome: string; bytes: Uint8Array; sha256: string },
): Promise<ResultadoSeguradora<unknown>> {
  return chamar<unknown>(`${base()}/non-payments/${encodeURIComponent(protocolo)}/documents`, {
    method: 'POST',
    body: {
      fileName: arquivo.nome,
      contentType: 'application/zip',
      sha256: arquivo.sha256,
      content: Buffer.from(arquivo.bytes).toString('base64'),
    },
  })
}
