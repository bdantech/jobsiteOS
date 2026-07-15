import { compileToPostgrest, normalizeCnpj } from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'
import type {
  ExploradorFiltros,
  ExploradorListItem,
  GrupoEconomico,
  Metricas,
  Segmento,
  UniversoDetalhe,
} from './types'

export const PAGE_SIZE = 25

/** Cap the sheet's lists: a holding can have hundreds of sócios and obras. */
const DETALHE_LIMIT = 50

/**
 * ONE string literal, never a concatenation: supabase-js infers the row type
 * from the literal handed to `.select()`. Split it across lines with `+` and the
 * type widens to `string`, the inference collapses, and every field access
 * downstream becomes an error on `GenericStringError`.
 */
const LIST_COLUMNS =
  'cnpj, razao_social, nome_fantasia, uf, municipio, camada, estagio, capital_social, is_spe, obras_ativas, erp_atual, grupo_id, empresa_id'

/**
 * PostgREST parses `or=(col.op.value,col.op.value)`. A comma or parenthesis
 * inside `value` is re-read as a clause separator / grouping, which lets a search
 * term restructure the filter; `%`, `_` and `*` are ILIKE wildcards (PostgREST
 * maps `*` → `%`). The `or` grammar gives us no way to escape any of them, so
 * strip them instead of handing PostgREST a filter the user can rewrite.
 *
 * Dots and slashes are deliberately kept: PostgREST splits each clause on its
 * first two dots only, so a dot in the value is safe — and "S.A." / "0001/81"
 * are exactly what people type into a company search box.
 *
 * Note this is the SEARCH BOX only. The composite tree does not come through
 * here: it is compiled by `compileToPostgrest()`, which quotes its own values.
 */
function sanitizeTermo(termo: string): string {
  return termo
    .replace(/[(),"\\%_*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Everything that must hold at once, as a single PostgREST expression.
 *
 * `.or(x)` sends `or=(x)`. A one-element OR is just `x`, so `.or('and(a,b)')` is
 * `a AND b` — which is why the composite tree (itself an `and(...)`/`or(...)`)
 * and the search clause can be ANDed together and passed through the same call.
 * Calling `.or()` twice would ALSO work (PostgREST ANDs repeated params), but
 * one expression is one thing to reason about.
 */
function combinar(partes: readonly string[]): string | null {
  if (partes.length === 0) return null
  if (partes.length === 1) return partes[0] ?? null
  return `and(${partes.join(',')})`
}

export interface ExploradorPage {
  rows: ExploradorListItem[]
  /**
   * Only requested on page 0. Counting the result set again on every scroll of a
   * ~2M-row table buys nothing — the total does not change between pages.
   */
  total: number | null
}

export async function fetchExploradorPage(
  filtros: ExploradorFiltros,
  page: number,
): Promise<ExploradorPage> {
  const from = page * PAGE_SIZE
  const contar = page === 0

  let query = supabase
    .from('mercado_explorador')
    .select(LIST_COLUMNS, {
      // 'estimated' = exact for small result sets, the planner's estimate for big
      // ones. 'exact' would seq-scan millions of rows on every keystroke.
      count: contar ? 'estimated' : undefined,
    })
    // Biggest capital first: that is the order a prospector reads a market in.
    // `cnpj` is the tiebreak that makes range() pagination deterministic —
    // without it two rows with the same capital can swap pages.
    .order('capital_social', { ascending: false, nullsFirst: false })
    .order('cnpj', { ascending: true })
    .range(from, from + PAGE_SIZE - 1)

  // Chips are plain equality — one query param each, ANDed by PostgREST.
  if (filtros.camada) query = query.eq('camada', filtros.camada)
  if (filtros.uf) query = query.eq('uf', filtros.uf)

  const partes: string[] = []

  const termo = sanitizeTermo(filtros.termo)
  if (termo) {
    const clauses = [`razao_social.ilike.*${termo}*`, `nome_fantasia.ilike.*${termo}*`]

    // "11.222.333/0001-81" and "11222333" must both find the row whose `cnpj`
    // column stores bare digits, so match the digits of the term against it.
    const digitos = normalizeCnpj(termo)
    if (digitos.length >= 2) clauses.push(`cnpj.ilike.*${digitos}*`)

    partes.push(`or(${clauses.join(',')})`)
  }

  // The composite tree — from a saved segmento or a Mapa deep link — compiled to
  // PostgREST, never to SQL. It runs under RLS like every other read here.
  if (filtros.filtro) partes.push(compileToPostgrest(filtros.filtro.arvore))

  const expressao = combinar(partes)
  if (expressao) query = query.or(expressao)

  const { data, count, error } = await query
  if (error) throw error

  // The view widens every column to nullable; `cnpj` is `not null` in both base
  // tables, so this narrowing drops nothing and buys a non-null key downstream.
  const rows = (data ?? []).filter((row): row is ExploradorListItem => row.cnpj !== null)

  return { rows, total: contar ? (count ?? rows.length) : null }
}

// ─── Segmentos ──────────────────────────────────────────────────────────────

/**
 * Saved filter trees. Mobile is query-only (§5.3): it does not build segmentos,
 * it CONSUMES them — the user picks one and its tree becomes the active filter.
 */
export async function fetchSegmentos(): Promise<Segmento[]> {
  const { data, error } = await supabase
    .from('segmentos')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(100)

  if (error) throw error
  return data ?? []
}

// ─── Registro do universo ───────────────────────────────────────────────────

export async function fetchUniversoDetalhe(cnpjBruto: string): Promise<UniversoDetalhe | null> {
  // The CNPJ arrives from a route param (and from the AI tool's `route`), so it
  // is not guaranteed to be 14 digits. Postgres would happily compare a garbage
  // string and return nothing; short-circuiting says the same thing without the
  // round trip, and keeps a malformed link out of the error state.
  const cnpj = normalizeCnpj(cnpjBruto)
  if (cnpj.length !== 14) return null

  const [universoResult, metricasResult, sociosResult, obrasResult] = await Promise.all([
    supabase.from('mercado_universo').select('*').eq('cnpj', cnpj).maybeSingle(),
    supabase.from('mercado_metricas').select('*').eq('cnpj', cnpj).maybeSingle(),
    supabase
      .from('mercado_socios')
      .select('*')
      .eq('cnpj', cnpj)
      .order('data_entrada', { ascending: false, nullsFirst: false })
      .limit(DETALHE_LIMIT),
    supabase
      .from('mercado_obras')
      .select('*')
      .eq('ni_responsavel', cnpj)
      .order('data_inicio_obra', { ascending: false, nullsFirst: false })
      .limit(DETALHE_LIMIT),
  ])

  if (universoResult.error) throw universoResult.error
  // Under RLS "denied" and "no such row" are the same zero-row answer, and both
  // mean this screen has nothing to show: that is the not-found state, not an error.
  if (!universoResult.data) return null

  if (metricasResult.error) throw metricasResult.error
  if (sociosResult.error) throw sociosResult.error
  if (obrasResult.error) throw obrasResult.error

  const universo = universoResult.data
  const metricas: Metricas | null = metricasResult.data

  let grupo: GrupoEconomico | null = null
  let grupoMembros = 0

  if (universo.grupo_id) {
    const [grupoResult, membrosResult] = await Promise.all([
      supabase.from('grupos_economicos').select('*').eq('id', universo.grupo_id).maybeSingle(),
      // Counted on the view, so RLS applies — never on the staging table directly.
      // A group is hundreds of rows at most, so 'exact' is honest and cheap here.
      supabase
        .from('mercado_explorador')
        .select('cnpj', { count: 'exact', head: true })
        .eq('grupo_id', universo.grupo_id),
    ])

    if (grupoResult.error) throw grupoResult.error
    if (membrosResult.error) throw membrosResult.error

    grupo = grupoResult.data
    grupoMembros = membrosResult.count ?? 0
  }

  return {
    universo,
    metricas,
    socios: sociosResult.data ?? [],
    obras: obrasResult.data ?? [],
    grupo,
    grupoMembros,
  }
}
