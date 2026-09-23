import { normalizeCnpj, resolverParaJson, type Grupo, type Json, type No } from '@jobsiteos/core'

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
/**
 * O termo, limpo dos curingas do ILIKE.
 *
 * `%` e `_` são curingas: quem digitasse "100%" pediria, sem saber, um `like`
 * que casa qualquer coisa. `*` some junto porque o PostgREST o traduz para `%`,
 * e a caixa de busca é a mesma nas duas plataformas.
 *
 * Os parênteses e a vírgula saem por herança do caminho anterior, que montava
 * uma expressão `or=(...)` onde eles eram separadores. A RPC recebe o termo
 * como PARÂMETRO e o interpola com `quote_literal`, então hoje eles seriam
 * inofensivos — mas um termo de busca não precisa deles, e deixá-los passar só
 * criaria a dúvida na próxima vez.
 *
 * Ponto e barra ficam de propósito: "S.A." e "0001/81" são exatamente o que se
 * digita numa busca de empresa.
 */
function sanitizeTermo(termo: string): string {
  return termo
    .replace(/[(),"\\%_*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
  /*
   * A BUSCA VAI PELA RPC, e isso não é preferência: é o que faz ela responder.
   *
   * Lendo `mercado_explorador` direto pelo PostgREST, o ILIKE roda SOB A RLS —
   * e sob a política o planner não usa os índices trigrama que existem em
   * `razao_social` e `nome_fantasia`. Ele escolhe percorrer o índice de
   * ordenação procurando as 25 primeiras correspondências, e num termo raro
   * isso é varrer 906 mil linhas: a consulta estoura o tempo e a tela mostra
   * vazio. Termo comum funcionava, termo específico não — que é justamente o
   * caso de quem digita o nome de UMA empresa.
   *
   * `mercado_explorar` é SECURITY DEFINER: por dentro não há RLS, o planner vê
   * as estatísticas limpas e o trigrama entra. É a mesma função que a web usa
   * desde sempre; o mobile é que tinha um segundo caminho, e era o quebrado.
   *
   * Ela já devolve uma linha a mais que a página para responder "tem próxima"
   * sem contar nada, e o total é a estimativa do planner.
   */
  const partes: No[] = []

  // Chips viram nós da árvore: a RPC só conhece UMA linguagem de filtro, e
  // manter camada/UF como parâmetro à parte criaria uma segunda.
  if (filtros.camada) partes.push({ variavel: 'camada', operador: 'igual', valor: filtros.camada })
  if (filtros.uf) partes.push({ variavel: 'uf', operador: 'igual', valor: filtros.uf })
  if (filtros.filtro) partes.push(filtros.filtro.arvore)

  const arvore: Grupo | null = partes.length > 0 ? { operador: 'e', condicoes: partes } : null
  const termo = sanitizeTermo(filtros.termo)

  const { data, error } = await supabase.rpc('mercado_explorar', {
    p_termo: termo || undefined,
    p_arvore: arvore ? (resolverParaJson(arvore) as unknown as Json) : undefined,
    // Maior capital primeiro: é a ordem em que um prospector lê um mercado.
    p_ordem: 'capital_social',
    p_asc: false,
    p_offset: page * PAGE_SIZE,
    p_limite: PAGE_SIZE,
  })
  if (error) throw error

  const resposta = data as unknown as { linhas: ExploradorListItem[]; total: number | null } | null
  const linhas = resposta?.linhas ?? []

  // A view alarga toda coluna para nullable; `cnpj` é `not null` nas duas
  // tabelas de base, então este estreitamento não descarta nada e garante uma
  // chave não-nula para a lista.
  const rows = linhas.slice(0, PAGE_SIZE).filter((row) => row.cnpj !== null)

  return { rows, total: page === 0 ? (resposta?.total ?? rows.length) : null }
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
