import { normalizeCnpj } from '../schemas/cnpj.js'
import { normalizarNumeroNf } from '../antecipacao/numero-nf.js'

/**
 * `GET /api/v1/sienge-installments` — uma linha por PARCELA de título do ERP.
 *
 * ── AS QUATRO ARMADILHAS, E POR QUE CADA UMA ESTÁ NO CÓDIGO ─────────────────
 *
 * 1. `firstSeenAt` é a data de ENTRADA. `hydratedAt` muda a cada releitura, e usá-lo
 *    como filtro de novidade faria a janela curta trazer eternamente as mesmas
 *    parcelas — cada leitura reempurrando a data para frente, para sempre.
 *
 * 2. A RETENÇÃO É TRI-ESTADO: `0` é "sem retenção", um valor é a retenção lida e
 *    `null` é "o ERP não informou". Tratar null como zero soma errado no relatório
 *    e, pior, exibe "sem retenção" com a mesma cara de um número conferido — o
 *    originador promete um líquido que a construtora não vai pagar.
 *
 * 3. `bill.billId` SÓ É ÚNICO DENTRO DE UMA CONEXÃO. Duas construtoras diferentes
 *    têm títulos de mesmo id, e usá-lo sozinho como chave mistura as carteiras de
 *    dois clientes. A PK é o `id` da API, que é global.
 *
 * 4. `creditor.taxId` vem NULO para credor pessoa física. Ele não casa com
 *    `empresas`, não entra no roteamento e não entra no agrupamento por fornecedor
 *    — juntar todos os credores PF sob "sem CNPJ" faria um fornecedor fictício com
 *    o volume somado de centenas de pessoas diferentes.
 */

export interface ConexaoTitulo {
  id?: number | string | null
  subdomain?: string | null
}

export interface ParticipanteTitulo {
  name?: string | null
  taxId?: string | null
  erpId?: number | string | null
}

export interface BillTitulo {
  billId?: number | string | null
  documentNumber?: string | null
  documentType?: string | null
  origin?: string | null
  status?: string | null
  accessKey?: string | null
  issueDate?: string | null
  totalAmount?: number | string | null
  withheldTaxTotal?: number | string | null
}

export interface NfeCandidateTitulo {
  accessKey?: string | null
  count?: number | string | null
}

export interface WriteBackTitulo {
  status?: string | null
  repointedAt?: string | null
}

export interface AnticipationTitulo {
  anticipationId?: number | string | null
  preAuthorizationId?: number | string | null
  status?: string | null
  netValue?: number | string | null
}

export interface TituloPayload {
  id?: number | string | null
  situation?: string | null
  guardReason?: string | null
  exceptionCode?: string | null
  firstSeenAt?: string | null
  hydratedAt?: string | null
  installmentId?: number | string | null
  installmentNumber?: number | string | null
  amount?: number | string | null
  withheldTax?: number | string | null
  dueDate?: string | null
  erpSituation?: string | null
  sentToBank?: boolean | null
  paymentType?: string | null
  erpPaidAt?: string | null
  erpRemovedAt?: string | null
  nfeCandidate?: NfeCandidateTitulo | null
  writeBack?: WriteBackTitulo | null
  bill?: BillTitulo | null
  connection?: ConexaoTitulo | null
  contractor?: ParticipanteTitulo | null
  creditor?: ParticipanteTitulo | null
  anticipation?: AnticipationTitulo | null
}

export interface RespostaTitulo {
  data?: TituloPayload[] | null
  items?: TituloPayload[] | null
  results?: TituloPayload[] | null
  total_pages?: number | null
  totalPages?: number | null
}

export const MOTIVOS_DESCARTE_TITULO = [
  'sem_id',
  'sem_situacao',
  'sem_valor',
  'sem_sacado',
  'sem_bill',
] as const
export type MotivoDescarteTitulo = (typeof MOTIVOS_DESCARTE_TITULO)[number]

export interface TituloNormalizado {
  id_externo: number
  situation: string
  guard_reason: string | null
  exception_code: string | null
  primeira_vez_visto: string | null
  hidratado_em: string | null
  installment_id: number | null
  installment_number: number | null
  valor: number
  /** TRI-ESTADO: `null` é "o ERP não informou", e nunca vira zero. */
  retencao: number | null
  vencimento: string | null
  erp_situacao: string | null
  enviado_banco: boolean | null
  tipo_pagamento: string | null
  erp_pago_em: string | null
  erp_removido_em: string | null
  nfe_candidate_access_key: string | null
  nfe_candidate_count: number | null
  write_back_status: string | null
  write_back_repointed_em: string | null
  bill_id: number
  bill_document_number: string | null
  bill_document_type: string | null
  bill_origin: string | null
  bill_status: string | null
  bill_access_key: string | null
  bill_issue_date: string | null
  bill_total: number | null
  bill_retencao_total: number | null
  connection_id: number | null
  connection_subdomain: string | null
  sacado_cnpj: string
  sacado_matriz_cnpj: string
  sacado_nome: string | null
  credor_cnpj: string | null
  credor_nome: string | null
  credor_erp_id: number | null
  credor_pessoa_fisica: boolean
  pre_autorizacao_id_externo: number | null
  anticipation_id_externo: number | null
  anticipation_status: string | null
  anticipation_net: number | null
  numero_normalizado: string | null
}

export type ResultadoNormalizacaoTitulo =
  | { ok: true; titulo: TituloNormalizado }
  | { ok: false; motivo: MotivoDescarteTitulo; id: string | null }

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function inteiro(v: unknown): number | null {
  const n = numero(v)
  return n === null ? null : Math.trunc(n)
}

function cnpj(v: unknown): string | null {
  const c = normalizeCnpj(String(v ?? ''))
  return c.length === 14 ? c : null
}

function data(v: unknown): string | null {
  const s = texto(v)
  if (!s) return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  return m?.[1] ?? null
}

/** 44 dígitos ou nada. Uma chave torta não casa com NF nenhuma e polui o índice. */
function chaveAcesso(v: unknown): string | null {
  const s = texto(v)?.replace(/\D/g, '') ?? null
  return s && s.length === 44 ? s : null
}

/**
 * A retenção, preservando o TRI-ESTADO.
 *
 * Existe como função de uma linha porque a alternativa (`Number(x) || 0`
 * espalhado) é exatamente o bug: ela colapsa `null` em `0` no ponto de uso, longe
 * de onde alguém pensaria no assunto.
 */
export function retencaoTriEstado(v: unknown): number | null {
  return numero(v)
}

export function normalizarTituloPayload(item: TituloPayload): ResultadoNormalizacaoTitulo {
  const idExterno = inteiro(item.id)
  if (idExterno === null) return { ok: false, motivo: 'sem_id', id: texto(item.id) }

  const situation = texto(item.situation)
  if (!situation) return { ok: false, motivo: 'sem_situacao', id: String(idExterno) }

  const valor = numero(item.amount)
  if (valor === null) return { ok: false, motivo: 'sem_valor', id: String(idExterno) }

  /*
   * O `contractor` do título é a construtora DONA DA CONEXÃO com o ERP — ou seja,
   * a matriz. O payload NÃO informa a SPE da parcela, mesmo quando o
   * empreendimento é de uma, e por isso aqui sacado e matriz são o mesmo CNPJ.
   *
   * Não é perda: é a granularidade que essa fonte tem. A SPE aparece depois, se a
   * parcela virar oferta — e aí é a pré-autorização que a revela (§4.1).
   */
  const sacado = cnpj(item.contractor?.taxId)
  if (!sacado) return { ok: false, motivo: 'sem_sacado', id: String(idExterno) }

  const billId = inteiro(item.bill?.billId)
  if (billId === null) return { ok: false, motivo: 'sem_bill', id: String(idExterno) }

  const credor = cnpj(item.creditor?.taxId)
  const documento = texto(item.bill?.documentNumber)

  return {
    ok: true,
    titulo: {
      id_externo: idExterno,
      situation,
      guard_reason: texto(item.guardReason),
      exception_code: texto(item.exceptionCode),
      primeira_vez_visto: texto(item.firstSeenAt),
      hidratado_em: texto(item.hydratedAt),
      installment_id: inteiro(item.installmentId),
      installment_number: inteiro(item.installmentNumber),
      valor,
      retencao: retencaoTriEstado(item.withheldTax),
      vencimento: data(item.dueDate),
      erp_situacao: texto(item.erpSituation),
      enviado_banco: item.sentToBank ?? null,
      tipo_pagamento: texto(item.paymentType),
      erp_pago_em: texto(item.erpPaidAt),
      erp_removido_em: texto(item.erpRemovedAt),
      nfe_candidate_access_key: chaveAcesso(item.nfeCandidate?.accessKey),
      nfe_candidate_count: inteiro(item.nfeCandidate?.count),
      write_back_status: texto(item.writeBack?.status),
      write_back_repointed_em: texto(item.writeBack?.repointedAt),
      bill_id: billId,
      bill_document_number: documento,
      bill_document_type: texto(item.bill?.documentType),
      bill_origin: texto(item.bill?.origin),
      bill_status: texto(item.bill?.status),
      bill_access_key: chaveAcesso(item.bill?.accessKey),
      bill_issue_date: data(item.bill?.issueDate),
      bill_total: numero(item.bill?.totalAmount),
      bill_retencao_total: retencaoTriEstado(item.bill?.withheldTaxTotal),
      connection_id: inteiro(item.connection?.id),
      connection_subdomain: texto(item.connection?.subdomain),
      sacado_cnpj: sacado,
      sacado_matriz_cnpj: sacado,
      sacado_nome: texto(item.contractor?.name),
      credor_cnpj: credor,
      credor_nome: texto(item.creditor?.name),
      credor_erp_id: inteiro(item.creditor?.erpId),
      credor_pessoa_fisica: credor === null,
      pre_autorizacao_id_externo: inteiro(item.anticipation?.preAuthorizationId),
      anticipation_id_externo: inteiro(item.anticipation?.anticipationId),
      anticipation_status: texto(item.anticipation?.status),
      anticipation_net: numero(item.anticipation?.netValue),
      numero_normalizado: normalizarNumeroNf(documento),
    },
  }
}

export function extrairTitulos(resp: RespostaTitulo | TituloPayload[] | null): TituloPayload[] {
  if (Array.isArray(resp)) return resp
  return resp?.data ?? resp?.items ?? resp?.results ?? []
}

export function totalDePaginasTitulo(resp: RespostaTitulo | unknown): number | null {
  const r = resp as RespostaTitulo | null
  return r?.total_pages ?? r?.totalPages ?? null
}
