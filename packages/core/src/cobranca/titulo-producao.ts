import { normalizeCnpj } from '../schemas/cnpj.js'

/**
 * O CONTRATO de `GET /api/v1/anticipation-settlements` (a resposta da produção à nossa
 * requisição de títulos, 28/09/2026) e a normalização dele para a linha de `titulos`.
 *
 * ── O QUE ESTE ENDPOINT RESOLVE ─────────────────────────────────────────────
 * Até aqui `titulos` era uma projeção de `antecipacoes`, e a antecipação paga continuava
 * `BILLET_SWAPPED`: todo título vencido parecia em aberto, pago ou não, e a migração da
 * plataforma (12/09) renumerou as operações e deixou as antigas congeladas. Aqui o título
 * tem a liquidação de verdade (`settlement.status`, `paidAt` = data do pagamento pelo
 * sacado), a matriz resolvida pela própria produção e o limite vigente.
 *
 * ── TRÊS NOMES QUE ENGANAM ──────────────────────────────────────────────────
 *   • `grossValue` aqui é o valor do BOLETO (nota − retenção) — o que o sacado deve. No
 *     `/anticipations` o mesmo nome é o valor da NOTA; aqui a nota vai em `invoiceAmount`.
 *   • `contractor` é quem DEVE (SPE, filial ou tomador); `contracted` é o cedente.
 *   • `updated_to` é EXCLUSIVO: janelas contíguas não se sobrepõem.
 *
 * Errar um nome de campo aqui não aparece em typecheck: aparece como título sem valor ou
 * sem matriz, com HTTP 200. Por isso a normalização descarta com motivo, e os testes
 * fixam o formato que a produção documentou.
 */

export interface ParteTituloProducao {
  name?: string | null
  taxId?: string | null
  headquartersTaxId?: string | null
  /** Devedor diferente da construtora responsável pela operação (tomador). */
  thirdParty?: boolean | null
}

export interface LiquidacaoTituloProducao {
  status?: string | null
  /** A data do PAGAMENTO pelo sacado — não a do registro. */
  paidAt?: string | null
  /** STARK_WEBHOOK | CNAB_RETURN | MANUAL | LEGACY */
  source?: string | null
  paidAmount?: number | string | null
  payments?: unknown[] | null
}

export interface SacadoLimiteProducao {
  /** O documento contra o qual a plataforma consome o limite. */
  taxId?: string | null
  creditLimit?: number | string | null
  creditLimitUpdatedAt?: string | null
  creditLimitExpiresAt?: string | null
}

export interface TituloProducaoPayload {
  id?: string | number | null
  anticipationId?: string | number | null
  migrated?: boolean | null
  documentNumber?: string | number | null
  contractor?: ParteTituloProducao | null
  contracted?: ParteTituloProducao | null
  grossValue?: number | string | null
  invoiceAmount?: number | string | null
  withheldTaxAmount?: number | string | null
  netValue?: number | string | null
  disbursedAt?: string | null
  originalDueDate?: string | null
  currentDueDate?: string | null
  overdue?: boolean | null
  settlement?: LiquidacaoTituloProducao | null
  drawee?: SacadoLimiteProducao | null
  updatedAt?: string | null
}

export interface RespostaTitulosProducao {
  data?: TituloProducaoPayload[]
  items?: TituloProducaoPayload[]
  page?: number
  pageSize?: number
  total?: number
  totalPages?: number
  total_pages?: number
}

export function extrairTitulosProducao(resp: RespostaTitulosProducao): TituloProducaoPayload[] {
  if (Array.isArray(resp.data)) return resp.data
  if (Array.isArray(resp.items)) return resp.items
  if (Array.isArray(resp)) return resp as TituloProducaoPayload[]
  return []
}

export function totalDePaginasTitulosProducao(resp: RespostaTitulosProducao): number | undefined {
  return resp.totalPages ?? resp.total_pages
}

// ─── A linha normalizada ────────────────────────────────────────────────────

export const STATUS_LIQUIDACAO_PRODUCAO = {
  OPEN: 'aberto',
  PARTIALLY_PAID: 'parcial',
  PAID: 'pago',
} as const

export type StatusTituloProducao = (typeof STATUS_LIQUIDACAO_PRODUCAO)[keyof typeof STATUS_LIQUIDACAO_PRODUCAO]

export const FONTES_LIQUIDACAO = ['STARK_WEBHOOK', 'CNAB_RETURN', 'MANUAL', 'LEGACY'] as const
export type FonteLiquidacao = (typeof FONTES_LIQUIDACAO)[number]

export const FONTE_LIQUIDACAO_LABELS: Record<FonteLiquidacao, string> = {
  STARK_WEBHOOK: 'Banco (evento)',
  CNAB_RETURN: 'Banco (arquivo de retorno)',
  MANUAL: 'Baixa manual',
  LEGACY: 'Sistema anterior',
}

/** O que vai para `app__cobranca_ingerir_titulos` (0273): as colunas de `titulos`. */
export interface TituloProducaoNormalizado {
  externo_id: string
  antecipacao_id_externo: number | null
  migrado: boolean
  numero: string | null
  sacado_cnpj: string
  sacado_nome: string | null
  /** Da produção; `null` só se ela não mandar (e o SQL resolve pela raiz). */
  sacado_matriz_cnpj: string | null
  devedor_terceiro: boolean
  cedente_cnpj: string
  cedente_nome: string | null
  cedente_matriz_cnpj: string | null
  valor_face: number
  valor_nota: number | null
  retencao: number | null
  valor_cedido: number | null
  desembolsado_em: string | null
  vencimento: string
  vencimento_prorrogado: string | null
  status: StatusTituloProducao
  status_producao: string
  pago_em: string | null
  valor_pago: number | null
  liquidacao_fonte: string | null
  liquidacao_pagamentos: unknown[]
  limite_credito_vigente: number | null
  limite_documento: string | null
  limite_atualizado_em: string | null
  limite_expira_em: string | null
  atualizado_producao_em: string | null
}

export type ResultadoNormalizacaoTituloProducao =
  | { ok: true; titulo: TituloProducaoNormalizado }
  | { ok: false; id: string | null; motivo: MotivoDescarteTituloProducao }

export const MOTIVOS_DESCARTE_TITULO_PRODUCAO = [
  'sem_id',
  'sem_devedor',
  'sem_cedente',
  'sem_valor',
  'sem_vencimento',
  'status_desconhecido',
] as const
export type MotivoDescarteTituloProducao = (typeof MOTIVOS_DESCARTE_TITULO_PRODUCAO)[number]

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function cnpjOuNull(v: unknown): string | null {
  const t = texto(v)
  if (!t) return null
  const n = normalizeCnpj(t)
  return /^\d{14}$/.test(n) ? n : null
}

/** `2026-09-30` de um ISO com ou sem hora. A data vem no fuso da produção (-03:00). */
function dataCivil(v: unknown): string | null {
  const t = texto(v)
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null
}

function instante(v: unknown): string | null {
  const t = texto(v)
  if (!t) return null
  return Number.isNaN(Date.parse(t)) ? null : t
}

export function normalizarTituloProducao(p: TituloProducaoPayload): ResultadoNormalizacaoTituloProducao {
  const id = texto(p.id)
  if (!id) return { ok: false, id: null, motivo: 'sem_id' }

  const sacado = cnpjOuNull(p.contractor?.taxId)
  if (!sacado) return { ok: false, id, motivo: 'sem_devedor' }
  const cedente = cnpjOuNull(p.contracted?.taxId)
  if (!cedente) return { ok: false, id, motivo: 'sem_cedente' }

  const valor = numero(p.grossValue)
  if (valor === null) return { ok: false, id, motivo: 'sem_valor' }
  const vencimento = dataCivil(p.originalDueDate)
  if (!vencimento) return { ok: false, id, motivo: 'sem_vencimento' }

  const statusProducao = (texto(p.settlement?.status) ?? '').toUpperCase()
  const status = STATUS_LIQUIDACAO_PRODUCAO[statusProducao as keyof typeof STATUS_LIQUIDACAO_PRODUCAO]
  if (!status) return { ok: false, id, motivo: 'status_desconhecido' }

  const vigente = dataCivil(p.currentDueDate)
  const antecipacao = numero(p.anticipationId)

  return {
    ok: true,
    titulo: {
      externo_id: id,
      antecipacao_id_externo: antecipacao !== null && Number.isInteger(antecipacao) ? antecipacao : null,
      migrado: p.migrated === true,
      numero: texto(p.documentNumber),
      sacado_cnpj: sacado,
      sacado_nome: texto(p.contractor?.name),
      sacado_matriz_cnpj: cnpjOuNull(p.contractor?.headquartersTaxId),
      devedor_terceiro: p.contractor?.thirdParty === true,
      cedente_cnpj: cedente,
      cedente_nome: texto(p.contracted?.name),
      cedente_matriz_cnpj: cnpjOuNull(p.contracted?.headquartersTaxId),
      valor_face: valor,
      valor_nota: numero(p.invoiceAmount),
      retencao: numero(p.withheldTaxAmount),
      valor_cedido: numero(p.netValue),
      desembolsado_em: instante(p.disbursedAt),
      vencimento,
      // A prorrogação é conversa comercial; o relógio da apólice só lê `vencimento`.
      vencimento_prorrogado: vigente && vigente !== vencimento ? vigente : null,
      status,
      status_producao: statusProducao,
      // Parcial não regulariza: a produção manda `paidAt: null`, e aqui fica nulo também.
      pago_em: status === 'pago' ? dataCivil(p.settlement?.paidAt) : null,
      valor_pago: numero(p.settlement?.paidAmount),
      liquidacao_fonte: texto(p.settlement?.source),
      liquidacao_pagamentos: Array.isArray(p.settlement?.payments) ? p.settlement!.payments! : [],
      // `null` é "sem análise aprovada", nunca zero (a produção faz a mesma distinção).
      limite_credito_vigente: numero(p.drawee?.creditLimit),
      limite_documento: cnpjOuNull(p.drawee?.taxId),
      limite_atualizado_em: instante(p.drawee?.creditLimitUpdatedAt),
      limite_expira_em: dataCivil(p.drawee?.creditLimitExpiresAt),
      atualizado_producao_em: instante(p.updatedAt),
    },
  }
}
