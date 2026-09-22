import { normalizeCnpj } from '../schemas/cnpj.js'
import { normalizarNumeroNf } from '../antecipacao/numero-nf.js'

/**
 * `GET /api/v1/pre-authorizations` — a oferta que a construtora já fez.
 *
 * Vive no core, e não no worker, pelo mesmo motivo do plano de sincronização das
 * NFs: isto é o CONTRATO de uma API de terceiro, e contrato errado não aparece em
 * typecheck nem em review. Aparece como um campo que chega nulo para sempre, ou
 * como uma classe inteira de oferta descartada em silêncio — que foi exatamente o
 * que aconteceu com a NFS-e em 13/09/2026, por nove dias e 9.463 notas.
 */

export interface ParticipantePreAuth {
  name?: string | null
  taxId?: string | null
  /** Só no `contractor`: a MATRIZ. `taxId` pode ser filial ou SPE. */
  headquartersTaxId?: string | null
  /** Só no `contracted`: false = fornecedor sem cadastro, e aí `name` vem nulo. */
  registered?: boolean | null
}

export interface SiengeRefPreAuth {
  billId?: number | string | null
  installmentId?: number | string | null
  installmentNumber?: number | string | null
  documentNumber?: string | null
}

export interface PreAuthPayload {
  id?: number | string | null
  status?: string | null
  origin?: string | null
  migrated?: boolean | null
  identification?: string | null
  createdAt?: string | null
  expiresAt?: string | null
  requestedAt?: string | null
  amount?: number | string | null
  invoiceNumber?: string | null
  dueDate?: string | null
  contractor?: ParticipantePreAuth | null
  contracted?: ParticipantePreAuth | null
  anticipationId?: number | string | null
  revokedReason?: string | null
  sienge?: SiengeRefPreAuth | null
}

export interface RespostaPreAuth {
  data?: PreAuthPayload[] | null
  items?: PreAuthPayload[] | null
  results?: PreAuthPayload[] | null
  total_pages?: number | null
  totalPages?: number | null
}

/**
 * Por que uma oferta foi descartada — e não só QUANTAS foram.
 *
 * `ignoradas` sozinha é um número que não responde nada. A lição custou nove dias
 * de funil vazio: o motivo existia num `logger.warn` que ninguém lê, e a única
 * forma de ele virar alarme é entrar no `meta` da ingestão, que é o que a tela de
 * Ingestões mostra.
 */
export const MOTIVOS_DESCARTE_PREAUTH = [
  'sem_id',
  'sem_status',
  'sem_valor',
  'sem_sacado',
  'sem_fornecedor',
] as const
export type MotivoDescartePreAuth = (typeof MOTIVOS_DESCARTE_PREAUTH)[number]

export interface PreAutorizacaoNormalizada {
  id_externo: number
  status: string
  origin: string
  migrated: boolean | null
  identification: string | null
  criada_em: string | null
  expira_em: string | null
  solicitada_em: string | null
  valor: number
  invoice_number: string | null
  numero_normalizado: string | null
  vencimento: string | null
  sacado_cnpj: string
  /** A MATRIZ. Ver `direcaoDaMatriz` abaixo — é ela que carrega toda relação. */
  sacado_matriz_cnpj: string
  sacado_nome: string | null
  fornecedor_cnpj: string
  fornecedor_nome: string | null
  fornecedor_cadastrado: boolean
  anticipation_id_externo: number | null
  revoked_reason: string | null
  sienge_bill_id: number | null
  sienge_installment_id: number | null
  sienge_installment_number: number | null
  sienge_document_number: string | null
}

export type ResultadoNormalizacaoPreAuth =
  | { ok: true; pre: PreAutorizacaoNormalizada }
  | { ok: false; motivo: MotivoDescartePreAuth; id: string | null }

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

/**
 * A MATRIZ do sacado, e a regra do sistema inteiro atrás dela (§4.1).
 *
 * Crédito, limite, carteira, roteamento, grupo econômico e certificados são
 * SEMPRE amarrados na matriz. A SPE ou filial é detalhe da operação, nunca a
 * entidade que carrega a relação — uma construtora com trinta SPEs teria trinta
 * limites de crédito separados, cada um com um pedaço do risco, e nenhum deles
 * descrevendo a empresa que de fato paga.
 *
 * A pré-autorização é a ÚNICA das três fontes que traz as duas pontas: guardamos
 * as duas e usamos a matriz para tudo que é relação. Quando `headquartersTaxId`
 * não vem, o próprio `taxId` é a matriz — é o que a API está dizendo ao omitir.
 */
export function matrizDoSacado(p: ParticipantePreAuth | null | undefined): {
  sacado: string | null
  matriz: string | null
} {
  const sacado = cnpj(p?.taxId)
  const matriz = cnpj(p?.headquartersTaxId) ?? sacado
  return { sacado, matriz }
}

export function normalizarPreAuthPayload(item: PreAuthPayload): ResultadoNormalizacaoPreAuth {
  const idExterno = inteiro(item.id)
  if (idExterno === null) return { ok: false, motivo: 'sem_id', id: texto(item.id) }

  const status = texto(item.status)
  if (!status) return { ok: false, motivo: 'sem_status', id: String(idExterno) }

  const valor = numero(item.amount)
  if (valor === null) return { ok: false, motivo: 'sem_valor', id: String(idExterno) }

  const { sacado, matriz } = matrizDoSacado(item.contractor)
  if (!sacado || !matriz) return { ok: false, motivo: 'sem_sacado', id: String(idExterno) }

  const fornecedor = cnpj(item.contracted?.taxId)
  if (!fornecedor) return { ok: false, motivo: 'sem_fornecedor', id: String(idExterno) }

  const invoiceNumber = texto(item.invoiceNumber)

  return {
    ok: true,
    pre: {
      id_externo: idExterno,
      status,
      origin: texto(item.origin) ?? 'desconhecida',
      migrated: item.migrated ?? null,
      identification: texto(item.identification),
      criada_em: texto(item.createdAt),
      expira_em: texto(item.expiresAt),
      solicitada_em: texto(item.requestedAt),
      valor,
      invoice_number: invoiceNumber,
      /*
       * O MESMO normalizador do 04e, e não um equivalente.
       *
       * Zeros à esquerda saem, zeros à direita ficam, série não participa. Duas
       * implementações "equivalentes" divergiriam no primeiro número torto — e o
       * efeito de divergir aqui não é um erro na tela: é uma NF escondida atrás de
       * uma pré-autorização que não é dela.
       */
      numero_normalizado: normalizarNumeroNf(invoiceNumber),
      vencimento: data(item.dueDate),
      sacado_cnpj: sacado,
      sacado_matriz_cnpj: matriz,
      sacado_nome: texto(item.contractor?.name),
      fornecedor_cnpj: fornecedor,
      /*
       * `name` vem NULO quando o fornecedor não tem cadastro, e isso não é um
       * buraco no payload: é a oportunidade de AQUISIÇÃO mais bem qualificada que
       * existe. A construtora já quis antecipar para alguém que ainda não é nosso.
       */
      fornecedor_nome: texto(item.contracted?.name),
      fornecedor_cadastrado: item.contracted?.registered === true,
      anticipation_id_externo: inteiro(item.anticipationId),
      revoked_reason: texto(item.revokedReason),
      sienge_bill_id: inteiro(item.sienge?.billId),
      sienge_installment_id: inteiro(item.sienge?.installmentId),
      sienge_installment_number: inteiro(item.sienge?.installmentNumber),
      sienge_document_number: texto(item.sienge?.documentNumber),
    },
  }
}

export function extrairPreAuths(resp: RespostaPreAuth | PreAuthPayload[] | null): PreAuthPayload[] {
  if (Array.isArray(resp)) return resp
  return resp?.data ?? resp?.items ?? resp?.results ?? []
}

export function totalDePaginasPreAuth(resp: RespostaPreAuth | unknown): number | null {
  const r = resp as RespostaPreAuth | null
  return r?.total_pages ?? r?.totalPages ?? null
}
