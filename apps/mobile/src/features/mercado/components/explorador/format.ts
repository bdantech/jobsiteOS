import { CAMADA_LABELS, formatCnpj, type Camada } from '@jobsiteos/core'

import type { BadgeVariant } from '@/components/ui/badge'
import type { ExploradorListItem } from './types'

/**
 * Formatting for the Explorador. Deliberately NOT imported from
 * `@/features/empresas`: the Grupo section (spec §5.4) puts a Mercado component
 * on the Company 360, so empresas will import mercado — and a feature that
 * imports back would close the cycle. Mercado stays self-contained.
 */

/**
 * `mercado_explorador.camada` is plain `text` (a CHECK constraint, not an enum),
 * so a row can carry a value this build has no label for. Fall back to the raw
 * value instead of rendering `undefined`.
 */
export function camadaLabel(camada: string | null): string {
  if (!camada) return '—'
  return CAMADA_LABELS[camada as Camada] ?? camada
}

/** The pyramid read as colour: universo is cold, SOM is the one we can win today. */
const CAMADA_VARIANTS: Record<Camada, BadgeVariant> = {
  universo: 'outline',
  tam: 'secondary',
  sam: 'success',
  som: 'default',
}

export function camadaVariant(camada: string | null): BadgeVariant {
  if (!camada) return 'outline'
  return CAMADA_VARIANTS[camada as Camada] ?? 'outline'
}

const SITUACAO_LABELS: Record<string, string> = {
  ativa: 'Ativa',
  suspensa: 'Suspensa',
  inapta: 'Inapta',
  baixada: 'Baixada',
  nula: 'Nula',
}

export function situacaoLabel(situacao: string | null): string | null {
  if (!situacao) return null
  return SITUACAO_LABELS[situacao] ?? situacao
}

export function situacaoVariant(situacao: string | null): BadgeVariant {
  return situacao === 'ativa' ? 'success' : 'secondary'
}

const SITUACAO_OBRA_VARIANTS: Record<string, BadgeVariant> = {
  Ativa: 'success',
  Paralisada: 'secondary',
  Encerrada: 'outline',
  Nula: 'outline',
}

export function situacaoObraVariant(situacao: string | null): BadgeVariant {
  if (!situacao) return 'outline'
  return SITUACAO_OBRA_VARIANTS[situacao] ?? 'secondary'
}

const PORTE_LABELS: Record<string, string> = {
  ME: 'Microempresa',
  EPP: 'Empresa de pequeno porte',
  DEMAIS: 'Demais',
}

export function porteLabel(porte: string | null): string | null {
  if (!porte) return null
  return PORTE_LABELS[porte] ?? porte
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

/** `capital_social` / `erp_mrr` are `numeric` → `number | null`. R$ 0 is a value; null is not. */
export function formatMoeda(valor: number | null): string | null {
  return valor === null ? null : currencyFormatter.format(valor)
}

const numberFormatter = new Intl.NumberFormat('pt-BR')

export function formatNumero(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? '—' : numberFormatter.format(valor)
}

export function formatM2(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—'
  return `${numberFormatter.format(Math.round(valor))} m²`
}

/**
 * `date` columns arrive as "YYYY-MM-DD". `new Date('2020-01-01')` parses as UTC
 * midnight, which in America/Sao_Paulo (UTC-3) formats as 31/12/2019 — a company
 * founded on the 1st would render as founded the day before. Split the string.
 */
export function formatData(iso: string | null): string | null {
  if (!iso) return null
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  if (!ano || !mes || !dia) return null
  return `${dia}/${mes}/${ano}`
}

/** Full years since the start of activity — the `idade_anos` of the filter catalog. */
export function idadeAnos(dataInicio: string | null, hoje: Date = new Date()): number | null {
  if (!dataInicio) return null
  const [ano, mes, dia] = dataInicio.slice(0, 10).split('-').map(Number)
  if (!ano || !mes || !dia) return null

  let anos = hoje.getFullYear() - ano
  const mesAtual = hoje.getMonth() + 1
  // The anniversary hasn't come round yet this year.
  if (mesAtual < mes || (mesAtual === mes && hoje.getDate() < dia)) anos -= 1

  return anos >= 0 ? anos : null
}

/** A universe row may have no razão social (the column is nullable). Never render "null". */
export function tituloEmpresa(
  row: Pick<ExploradorListItem, 'razao_social' | 'nome_fantasia' | 'cnpj'>,
): string {
  return row.nome_fantasia || row.razao_social || formatCnpj(row.cnpj)
}

/** "São Paulo · SP", or null when neither is set. */
export function localizacao(municipio: string | null, uf: string | null): string | null {
  const partes = [municipio, uf].filter((parte): parte is string => Boolean(parte))
  return partes.length > 0 ? partes.join(' · ') : null
}

/**
 * The count comes back as `estimated`: exact for small results, the planner's
 * estimate for large ones (an exact count over ~2M rows costs a seq scan on
 * every keystroke). Say "aproximadamente" once the number is big enough that it
 * is certainly the estimate, instead of presenting a guess as a fact.
 */
const LIMIAR_ESTIMATIVA = 1000

export function formatTotal(total: number | null): string {
  if (total === null) return 'Carregando…'
  if (total === 0) return 'Nenhuma empresa'
  if (total === 1) return '1 empresa'
  const numero = numberFormatter.format(total)
  return total >= LIMIAR_ESTIMATIVA ? `~ ${numero} empresas` : `${numero} empresas`
}

/** The 8 UFs of the seeded SAM rule come first — they are where the business is. */
const UFS_PRIORITARIAS = ['SP', 'SC', 'PR', 'RS', 'MG', 'RJ', 'GO', 'DF'] as const
const UFS_RESTANTES = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'ES',
  'MA',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'RN',
  'RO',
  'RR',
  'SE',
  'TO',
] as const

export const UFS: readonly string[] = [...UFS_PRIORITARIAS, ...UFS_RESTANTES]
