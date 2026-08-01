import { normalizeCnpj } from '../schemas/cnpj.js'
import { normalizarNumeroNf } from './numero-nf.js'

/**
 * O CONTRATO do endpoint de antecipações (`/api/v1/anticipations`) e a
 * normalização dele.
 *
 * Vive no core pelo mesmo motivo de `nf-payload.ts`: é o formato de uma API que
 * não controlamos, e errar um nome de campo aqui não aparece em typecheck —
 * aparece como zero conversões, com HTTP 200.
 *
 * A inversão que este arquivo existe para não deixar ninguém errar:
 *
 *   contractor = SACADO      (a construtora que deve)
 *   contracted = FORNECEDOR  (o cedente que antecipa)
 *
 * Trocá-los não quebra nada: o matching simplesmente nunca encontra candidata, e
 * o funil fica com 100% de `sem_nf` sem que nenhum erro seja registrado.
 */

export interface ParteAntecipacao {
  name?: string | null
  taxId?: string | null
}

export interface AntecipacaoPayload {
  id?: number | string | null
  status?: string | null
  anticipationType?: string | null
  documentNumber?: string | number | null
  requestDate?: string | null
  createdAt?: string | null
  originalDueDate?: string | null
  completionDate?: string | null
  anticipationDays?: number | string | null
  grossValue?: number | string | null
  /** `withold`, com um L só — é assim que a API escreve. */
  witholdTaxAmount?: number | string | null
  withholdTaxAmount?: number | string | null
  discountedAmount?: number | string | null
  netValue?: number | string | null
  totalSpreadAmount?: number | string | null
  monthlyInterestRate?: number | string | null
  /** A construtora. */
  contractor?: ParteAntecipacao | null
  /** O fornecedor/cedente. */
  contracted?: ParteAntecipacao | null
  approvalWithAutomation?: boolean | null
  invoiceCancelledAt?: string | null
}

export interface RespostaAntecipacoes {
  data?: AntecipacaoPayload[]
  items?: AntecipacaoPayload[]
  page?: number
  pageSize?: number
  total?: number
  totalPages?: number
  total_pages?: number
}

export function extrairAntecipacoes(resp: RespostaAntecipacoes): AntecipacaoPayload[] {
  if (Array.isArray(resp.data)) return resp.data
  if (Array.isArray(resp.items)) return resp.items
  if (Array.isArray(resp)) return resp as AntecipacaoPayload[]
  return []
}

export function totalDePaginasAntecipacoes(resp: RespostaAntecipacoes): number | undefined {
  return resp.totalPages ?? resp.total_pages
}

// ─── Coerções ───────────────────────────────────────────────────────────────

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

/** Só a parte da data: `2026-07-31T15:03:18` e `2026-08-14` viram `2026-08-14`. */
function data(v: unknown): string | null {
  const s = texto(v)
  if (!s) return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  return m?.[1] ?? null
}

/**
 * Timestamp preservando a hora. O endpoint manda `2026-07-31T15:03:18` sem fuso;
 * carimbamos `-03:00` porque a plataforma é brasileira e deixar o Postgres
 * assumir UTC deslocaria toda a base em três horas — o suficiente para a janela
 * de 3 dias do sync perder as antecipações da madrugada.
 */
function instante(v: unknown): string | null {
  const s = texto(v)
  if (!s) return null
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) return s
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? `${s}-03:00` : s
}

// ─── A normalização ─────────────────────────────────────────────────────────

export type MotivoDescarteAntecipacao = 'sem_id' | 'sem_cnpj'

export interface AntecipacaoNormalizada {
  id_externo: number
  status: string
  anticipation_type: string | null
  document_number: string | null
  /** O núcleo do número, pela MESMA função aplicada a `notas_fiscais.numero`. */
  numero_normalizado: string | null
  sacado_cnpj: string
  fornecedor_cnpj: string
  sacado_nome: string | null
  fornecedor_nome: string | null
  request_date: string | null
  created_at_plataforma: string | null
  original_due_date: string | null
  completion_date: string | null
  anticipation_days: number | null
  gross_value: number | null
  withhold_tax: number | null
  discounted_amount: number | null
  net_value: number | null
  total_spread: number | null
  monthly_interest_rate: number | null
  approval_with_automation: boolean | null
  invoice_cancelled_at: string | null
}

export type ResultadoNormalizacaoAntecipacao =
  | { ok: true; antecipacao: AntecipacaoNormalizada }
  | { ok: false; motivo: MotivoDescarteAntecipacao; id: string | null }

export function normalizarAntecipacaoPayload(
  item: AntecipacaoPayload,
): ResultadoNormalizacaoAntecipacao {
  const idExterno = inteiro(item.id)
  if (idExterno === null) return { ok: false, motivo: 'sem_id', id: texto(item.id) }

  const sacadoCnpj = normalizeCnpj(item.contractor?.taxId ?? '')
  const fornecedorCnpj = normalizeCnpj(item.contracted?.taxId ?? '')
  // Sem os dois CNPJs não há par para recortar candidatas — e sem par o
  // casamento seria por número solto contra a base inteira, que é exatamente o
  // erro que este módulo existe para não cometer.
  if (sacadoCnpj.length !== 14 || fornecedorCnpj.length !== 14) {
    return { ok: false, motivo: 'sem_cnpj', id: String(idExterno) }
  }

  const documentNumber = texto(item.documentNumber)

  return {
    ok: true,
    antecipacao: {
      id_externo: idExterno,
      status: (texto(item.status) ?? 'DESCONHECIDO').toUpperCase(),
      anticipation_type: texto(item.anticipationType),
      document_number: documentNumber,
      numero_normalizado: normalizarNumeroNf(documentNumber),
      sacado_cnpj: sacadoCnpj,
      fornecedor_cnpj: fornecedorCnpj,
      sacado_nome: texto(item.contractor?.name),
      fornecedor_nome: texto(item.contracted?.name),
      request_date: data(item.requestDate),
      created_at_plataforma: instante(item.createdAt),
      original_due_date: data(item.originalDueDate),
      completion_date: instante(item.completionDate),
      anticipation_days: inteiro(item.anticipationDays),
      gross_value: numero(item.grossValue),
      withhold_tax: numero(item.witholdTaxAmount) ?? numero(item.withholdTaxAmount),
      discounted_amount: numero(item.discountedAmount),
      net_value: numero(item.netValue),
      total_spread: numero(item.totalSpreadAmount),
      monthly_interest_rate: numero(item.monthlyInterestRate),
      approval_with_automation: item.approvalWithAutomation ?? null,
      invoice_cancelled_at: instante(item.invoiceCancelledAt),
    },
  }
}
