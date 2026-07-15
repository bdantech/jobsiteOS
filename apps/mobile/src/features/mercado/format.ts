import {
  CAMADA_DESCRICOES,
  CAMADA_LABELS,
  formatCnpj,
  type Camada,
} from '@jobsiteos/core'

import type { BadgeVariant } from '@/components/ui/badge'
import type { ColorTokens } from '@/lib/theme'
import type { ExploradorRow } from './types'

/**
 * `mercado_explorador.camada` is plain `text` (a CHECK constraint, not an enum),
 * so a row can carry a value this build has no label for. Fall back to the raw
 * value instead of rendering `undefined`.
 */
export function camadaLabel(camada: string | null): string {
  if (!camada) return '—'
  return CAMADA_LABELS[camada as Camada] ?? camada
}

export function camadaDescricao(camada: string | null): string {
  if (!camada) return ''
  return CAMADA_DESCRICOES[camada as Camada] ?? ''
}

/**
 * The pyramid read as colour: the deeper the fit, the stronger the accent.
 * `camada` is market fit — never confuse it with `estagio`, which is the
 * relationship history and has its own palette in the empresas module.
 */
const CAMADA_VARIANTS: Record<Camada, BadgeVariant> = {
  universo: 'outline',
  tam: 'secondary',
  sam: 'success',
  som: 'default',
}

export function camadaVariant(camada: string | null): BadgeVariant {
  return CAMADA_VARIANTS[camada as Camada] ?? 'outline'
}

/**
 * The layer's step on the ordinal chart ramp.
 *
 * universo ⊃ tam ⊃ sam ⊃ som is an ORDER, not a set of categories — swapping two
 * of them would change the meaning. So the ramp is ONE hue (220°) varying in
 * lightness, and the reader gets the order from the colour itself. Spending four
 * distinct hues here would burn the identity channel to re-encode an order that
 * lightness already shows.
 *
 * This used to be a `fillOpacity` over `primary`. That produced a ramp by
 * accident rather than by derivation: the steps were never checked for
 * monotonicity, and in dark mode it composited against whatever sat behind the
 * SVG. The `--chart-*` tokens are the validated ramp — monotonic in both themes,
 * with the anchor inverted in the dark one — so use them and let the theme own
 * the values.
 */
export type ChartToken = Extract<keyof ColorTokens, 'chart1' | 'chart2' | 'chart3' | 'chart4'>

export const CAMADA_CHART: Record<Camada, ChartToken> = {
  universo: 'chart1',
  tam: 'chart2',
  sam: 'chart3',
  som: 'chart4',
}

// ─── Números ────────────────────────────────────────────────────────────────

const inteiroFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const decimalFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const moedaFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatInteiro(valor: number): string {
  return inteiroFormatter.format(valor)
}

export function formatPercentual(valor: number): string {
  return `${decimalFormatter.format(valor)}%`
}

/** Share of a whole, 0–100. A zero whole has no share — it is 0, not NaN. */
export function participacao(parte: number, total: number): number {
  return total > 0 ? (parte / total) * 100 : 0
}

/**
 * Capital social runs from R$ 1.000 to R$ 10 bi. Spelling out every digit on a
 * phone card is unreadable, so abbreviate above a thousand. `Intl` `notation:
 * 'compact'` is not reliable on Hermes, hence the manual ladder.
 */
export function formatMoedaCompacta(valor: number | null): string {
  if (valor === null) return '—'
  const abs = Math.abs(valor)
  if (abs >= 1_000_000_000) return `R$ ${decimalFormatter.format(valor / 1_000_000_000)} bi`
  if (abs >= 1_000_000) return `R$ ${decimalFormatter.format(valor / 1_000_000)} mi`
  if (abs >= 1_000) return `R$ ${decimalFormatter.format(valor / 1_000)} mil`
  return moedaFormatter.format(valor)
}

/** Exact currency, for the fields that must not be rounded (MRR do ERP). */
export function formatMoeda(valor: number | null): string | null {
  return valor === null ? null : moedaFormatter.format(valor)
}

export function formatArea(valor: number | null): string {
  if (valor === null) return '—'
  return `${inteiroFormatter.format(valor)} m²`
}

// ─── Datas ──────────────────────────────────────────────────────────────────

const dataFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/** `date` columns come back as 'YYYY-MM-DD'. */
export function formatData(iso: string | null): string {
  if (!iso) return '—'
  // Parsed as UTC midnight; a plain `new Date('2020-01-01')` in UTC-3 renders as
  // 31/12/2019. Split the parts and build a local date instead.
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number)
  if (!ano || !mes || !dia) return '—'
  return dataFormatter.format(new Date(ano, mes - 1, dia))
}

export function anoDe(iso: string | null): number | null {
  if (!iso) return null
  const ano = Number(iso.slice(0, 4))
  return Number.isFinite(ano) && ano > 0 ? ano : null
}

export function idadeAnos(iso: string | null, hoje: Date = new Date()): number | null {
  if (!iso) return null
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number)
  if (!ano || !mes || !dia) return null
  let idade = hoje.getFullYear() - ano
  const aniversarioPassou =
    hoje.getMonth() + 1 > mes || (hoje.getMonth() + 1 === mes && hoje.getDate() >= dia)
  if (!aniversarioPassou) idade -= 1
  return idade >= 0 ? idade : null
}

// ─── Registros ──────────────────────────────────────────────────────────────

/** Structural, so it accepts any projection of the view — a MembroGrupo, an
 *  Explorador list row, a full ficha — without the two sides sharing a type. */
type RegistroIdentificavel = Pick<ExploradorRow, 'cnpj' | 'razao_social' | 'nome_fantasia'>

/** A universe row may have neither name (both columns are nullable). Never render "null". */
export function registroTitulo(registro: RegistroIdentificavel): string {
  return (
    registro.nome_fantasia ||
    registro.razao_social ||
    (registro.cnpj ? formatCnpj(registro.cnpj) : 'Sem identificação')
  )
}

/** "São Paulo · SP", or null when neither is set. */
export function localizacao(municipio: string | null, uf: string | null): string | null {
  const partes = [municipio, uf].filter((parte): parte is string => Boolean(parte))
  return partes.length > 0 ? partes.join(' · ') : null
}

/**
 * Promoted rows have a Company 360; staging rows only have the lightweight
 * universe sheet. Same rule the AI tools apply, so a route never disagrees with
 * what the AI told the user.
 */
export function registroRota(
  registro: Pick<ExploradorRow, 'cnpj' | 'empresa_id'>,
): string | null {
  if (registro.empresa_id) return `/empresas/${registro.empresa_id}`
  return registro.cnpj ? `/mercado/universo/${registro.cnpj}` : null
}

export { formatCnpj }
