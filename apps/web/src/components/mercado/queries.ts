import {
  CAMADAS,
  parseArvore,
  type Camada,
  type Condicao,
  type Grupo,
  type Views,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * Reads for the Mercado module — and the query-key factory the whole module shares.
 *
 * Everything here runs in the BROWSER against the anon key + the user's session, so
 * every row that comes back has already been through RLS (`app_tem_modulo('mercado')`).
 * Writes never come through here: they are server actions over the write helpers in
 * `@jobsiteos/core` (mutations.ts), exactly as in Empresas.
 *
 * ONE surface for every read: the `mercado_explorador` view (migration 0012). It is
 * `security_invoker`, it already unions the staging universe with the companies that
 * only ever existed in `empresas` (list imports), and every catalog variable is a real
 * column on it.
 */

// ─── Query keys ─────────────────────────────────────────────────────────────
//
// The factory for the WHOLE module: the Mapa, the Explorador, the universe sheet,
// the grupo view, segmentos and camada rules all hang off `mercadoKeys.all`, so
// `queryClient.invalidateQueries({ queryKey: mercadoKeys.all })` after a promotion
// or a rule activation refreshes every one of them.

export const mercadoKeys = {
  all: ['mercado'] as const,
  mapa: (filtros: FiltrosMapa) => ['mercado', 'mapa', filtros] as const,
  /**
   * `filtros` is intentionally loose: the Explorador owns its own filter shape
   * (term + composite tree + sort + page). Anything JSON-serializable is a legal
   * key — React Query hashes it structurally.
   */
  explorador: (filtros: unknown) => ['mercado', 'explorador', filtros] as const,
  universo: (cnpj: string) => ['mercado', 'universo', cnpj] as const,
  grupo: (id: string) => ['mercado', 'grupo', id] as const,
  segmentos: () => ['mercado', 'segmentos'] as const,
  regras: () => ['mercado', 'regras'] as const,
}

// ─── Explorador: filtro na URL ──────────────────────────────────────────────
//
// The Mapa opens the Explorador PRE-FILTERED, and on web that means a new tab.
// A tab remembers a PATHNAME only (see stores/tabs.ts), so the filter must ride
// in the query string of the push — which makes this codec the contract between
// the two screens. It lives here, next to the keys, because both of them import it.

export const PARAM_FILTRO = 'filtro'
export const ROTA_EXPLORADOR = '/mercado/explorador'

/** Encodes a filter tree into `/mercado/explorador?filtro=…`. */
export function rotaExploradorComFiltro(arvore: Grupo): string {
  const param = encodeURIComponent(JSON.stringify(arvore))
  return `${ROTA_EXPLORADOR}?${PARAM_FILTRO}=${param}`
}

/**
 * Reads the tree back. The URL is user-writable input: it is parsed by the engine's
 * zod schema (`parseArvore`), so a hand-edited or stale link yields null instead of
 * a tree that names a column nobody whitelisted.
 */
export function lerFiltroDaUrl(valor: string | null | undefined): Grupo | null {
  if (!valor) return null
  try {
    return parseArvore(JSON.parse(valor))
  } catch {
    return null
  }
}

/** Builds the top-level AND group the Mapa's click-through always produces. */
export function arvoreDe(condicoes: Condicao[]): Grupo {
  return { operador: 'e', condicoes }
}

// ─── Mapa do Mercado ────────────────────────────────────────────────────────

export interface FiltrosMapa {
  uf: string | null
  tipo: 'construtora' | 'fornecedor' | null
}

export const FILTROS_MAPA_VAZIOS: FiltrosMapa = { uf: null, tipo: null }

export function temFiltroMapa(filtros: FiltrosMapa): boolean {
  return filtros.uf !== null || filtros.tipo !== null
}

/**
 * Rows pulled per layer to compute the distributional indicators.
 *
 * WHY A SAMPLE AND NOT AN AGGREGATE: PostgREST aggregate functions are DISABLED on
 * this project (`select=camada,capital_social.avg()` answers
 * `400 PGRST123 — Use of aggregate functions is not allowed`), and PostgREST has no
 * percentile aggregate even when they are on, so `capital social mediano` is out of
 * reach by construction. The only exact numbers the API can give us are COUNTS — and
 * the count is exactly what `{ count: 'exact' }` returns alongside the page. So each
 * layer costs ONE request that yields both:
 *
 *   • `total`   — exact, from the count header. Every headline number and every
 *                 percentage denominator uses it.
 *   • `amostra` — up to LIMITE_AMOSTRA rows, from which the means, the median and
 *                 the distributions are computed and then scaled back up to `total`.
 *
 * When `total > amostra.length` the distributional figures are ESTIMATES and the UI
 * says so, in words, on the page. This is a stopgap: see the note in the report —
 * the right fix is a `security invoker` RPC (`app_mercado_mapa(filtro jsonb)`) that
 * does the aggregation in Postgres and returns one row per layer.
 */
// 1000, não 5000: a amostra vai por mercado_mapa (p_limite) e 5000 × 4 camadas somava
// ~9s de build de JSON — acima do statement_timeout de 8s. Com 1000, a RPC toda fica em
// ~1s, e 1000 linhas por camada ainda são amostra de sobra para as médias/distribuições
// (que já são declaradas como estimativa na tela).
export const LIMITE_AMOSTRA = 1000

const COLUNAS_AMOSTRA =
  'uf, porte_rfb, tipo, capital_social, data_inicio_atividade, erp_atual, tem_contato, grafo_sefaz, grupo_id, grupo_spes_total, obras_ativas, m2_em_execucao' as const

type LinhaAmostra = Pick<
  Views<'mercado_explorador'>,
  | 'uf'
  | 'porte_rfb'
  | 'tipo'
  | 'capital_social'
  | 'data_inicio_atividade'
  | 'erp_atual'
  | 'tem_contato'
  | 'grafo_sefaz'
  | 'grupo_id'
  | 'grupo_spes_total'
  | 'obras_ativas'
  | 'm2_em_execucao'
>

export interface IndicadoresCamada {
  camada: Camada
  /** Exact — from the count header, never from the sample. */
  total: number
  /** How many rows the indicators below were actually computed over. */
  amostra: number
  /** True when the layer has more rows than the sample: everything below is an estimate. */
  estimado: boolean
  idadeMedia: number | null
  capitalMedio: number | null
  capitalMediano: number | null
  /** Shares in 0..1, over the rows of the sample. */
  pctErp: number | null
  pctContato: number | null
  pctSefaz: number | null
  /** Mean `grupo_spes_total` across the DISTINCT groups seen in the sample. */
  spesPorGrupo: number | null
  /** Sums, scaled from the sample to `total`. */
  obrasAtivas: number
  m2EmExecucao: number
}

export interface FatiaDistribuicao {
  /** The raw column value, or null for the "not informed" bucket. */
  chave: string | null
  label: string
  total: number
  porCamada: Record<Camada, number>
  /** Non-null only on the "Outras" bucket: the UFs it rolls up. */
  agrupa?: string[]
}

export interface Mapa {
  totalGeral: number
  /** True when ANY layer was sampled — the page's estimate banner hangs off this. */
  estimado: boolean
  camadas: IndicadoresCamada[]
  porUf: FatiaDistribuicao[]
  porPorte: FatiaDistribuicao[]
  porTipo: FatiaDistribuicao[]
}

const ZERO_POR_CAMADA: Record<Camada, number> = { universo: 0, tam: 0, sam: 0, som: 0 }

function media(valores: number[]): number | null {
  if (valores.length === 0) return null
  return valores.reduce((soma, v) => soma + v, 0) / valores.length
}

/** Mediana clássica: média dos dois centrais quando a amostra é par. */
function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const ordenados = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(ordenados.length / 2)
  if (ordenados.length % 2 === 1) return ordenados[meio] ?? null
  const a = ordenados[meio - 1]
  const b = ordenados[meio]
  if (a === undefined || b === undefined) return null
  return (a + b) / 2
}

const MS_POR_ANO = 365.25 * 24 * 60 * 60 * 1000

function idadeEmAnos(inicio: string, agora: number): number {
  return (agora - new Date(inicio).getTime()) / MS_POR_ANO
}

function indicadores(camada: Camada, total: number, linhas: LinhaAmostra[]): IndicadoresCamada {
  const agora = Date.now()
  const amostra = linhas.length
  // Scales a sample sum up to the layer. 0 when there is nothing to scale, so an
  // empty layer reports 0 obras rather than NaN.
  const fator = amostra > 0 ? total / amostra : 0

  const idades = linhas
    .map((l) => l.data_inicio_atividade)
    .filter((d): d is string => d !== null)
    .map((d) => idadeEmAnos(d, agora))
    .filter((n) => Number.isFinite(n) && n >= 0)

  const capitais = linhas
    .map((l) => l.capital_social)
    .filter((c): c is number => c !== null && Number.isFinite(c))

  // "Média de SPEs por grupo" is a group-level number: counting it per company would
  // weight a 200-SPE holding 200 times. Deduplicate by grupo_id first.
  const gruposVistos = new Map<string, number>()
  for (const linha of linhas) {
    if (linha.grupo_id) gruposVistos.set(linha.grupo_id, linha.grupo_spes_total ?? 0)
  }

  const proporcao = (predicado: (l: LinhaAmostra) => boolean): number | null =>
    amostra === 0 ? null : linhas.filter(predicado).length / amostra

  const soma = (extrator: (l: LinhaAmostra) => number): number =>
    Math.round(linhas.reduce((s, l) => s + extrator(l), 0) * fator)

  return {
    camada,
    total,
    amostra,
    estimado: total > amostra,
    idadeMedia: media(idades),
    capitalMedio: media(capitais),
    capitalMediano: mediana(capitais),
    pctErp: proporcao((l) => l.erp_atual !== null),
    pctContato: proporcao((l) => l.tem_contato === true),
    pctSefaz: proporcao((l) => l.grafo_sefaz === true),
    spesPorGrupo: media([...gruposVistos.values()]),
    obrasAtivas: soma((l) => l.obras_ativas ?? 0),
    m2EmExecucao: soma((l) => l.m2_em_execucao ?? 0),
  }
}

/** Bars past this point are noise; the tail rolls into a single clickable "Outras". */
const MAX_UFS = 12

const PORTE_LABELS: Record<string, string> = {
  ME: 'Microempresa (ME)',
  EPP: 'Pequeno porte (EPP)',
  DEMAIS: 'Demais',
}

const TIPO_LABELS: Record<string, string> = {
  construtora: 'Construtora',
  fornecedor: 'Fornecedor',
}

interface Balde {
  chave: string | null
  total: number
  porCamada: Record<Camada, number>
}

/**
 * Counts one column across every layer's sample, each layer scaled by its own
 * sample→total factor. Layers are sampled independently, so scaling per layer (and
 * not globally) is what keeps a 1.5M-row `universo` from drowning a fully-loaded SOM.
 */
function distribuir(
  amostras: Map<Camada, { total: number; linhas: LinhaAmostra[] }>,
  coluna: (l: LinhaAmostra) => string | null,
): Balde[] {
  const baldes = new Map<string, Balde>()

  for (const [camada, { total, linhas }] of amostras) {
    const fator = linhas.length > 0 ? total / linhas.length : 0

    for (const linha of linhas) {
      const chave = coluna(linha)
      const id = chave ?? ' null'
      let balde = baldes.get(id)
      if (!balde) {
        balde = { chave, total: 0, porCamada: { ...ZERO_POR_CAMADA } }
        baldes.set(id, balde)
      }
      balde.porCamada[camada] += fator
      balde.total += fator
    }
  }

  // Round only at the end: rounding each increment would drift by thousands of rows
  // over a 5.000-row sample scaled by 300.
  for (const balde of baldes.values()) {
    balde.total = Math.round(balde.total)
    for (const camada of CAMADAS) balde.porCamada[camada] = Math.round(balde.porCamada[camada])
  }

  return [...baldes.values()].sort((a, b) => b.total - a.total)
}

function fatia(balde: Balde, label: string): FatiaDistribuicao {
  return { chave: balde.chave, label, total: balde.total, porCamada: balde.porCamada }
}

export async function buscarMapa(filtros: FiltrosMapa): Promise<Mapa> {
  const supabase = createClient()

  // Uma RPC (mercado_mapa), não 4 queries com count:'exact' sobre a view. Com 876k
  // linhas reais, contar via a view custava ~11s por camada e a amostra forçava um hash
  // de 878k métricas (~4s) — ambos estouravam o statement_timeout de 8s do authenticated.
  // A função conta com index-only scan e LIMITA o universo antes de juntar as métricas,
  // devolvendo os 4 totais + amostras em ~1s. Era o "RPC app_mercado_mapa" prometido na
  // nota de LIMITE_AMOSTRA.
  const { data, error } = await supabase.rpc('mercado_mapa', {
    p_uf: filtros.uf,
    p_tipo: filtros.tipo,
    p_limite: LIMITE_AMOSTRA,
  })
  if (error) throw new Error(error.message)

  const resultados = (
    (data ?? []) as Array<{ camada: Camada; total: number; linhas: LinhaAmostra[] }>
  ).map((r) => ({ camada: r.camada, total: r.total, linhas: r.linhas ?? [] }))

  const amostras = new Map(
    resultados.map((r) => [r.camada, { total: r.total, linhas: r.linhas }] as const),
  )

  const ufs = distribuir(amostras, (l) => l.uf)
  const principais = ufs.slice(0, MAX_UFS)
  const cauda = ufs.slice(MAX_UFS)

  const porUf: FatiaDistribuicao[] = principais.map((b) =>
    fatia(b, b.chave ?? 'UF não informada'),
  )

  if (cauda.length > 0) {
    const somaCauda: Balde = {
      chave: null,
      total: cauda.reduce((s, b) => s + b.total, 0),
      porCamada: { ...ZERO_POR_CAMADA },
    }
    for (const balde of cauda) {
      for (const camada of CAMADAS) somaCauda.porCamada[camada] += balde.porCamada[camada]
    }
    porUf.push({
      ...fatia(somaCauda, `Outras (${cauda.length} UFs)`),
      // Kept so the click-through can compile `uf está em (…)` instead of dropping
      // the reader on an unfiltered Explorador.
      agrupa: cauda.map((b) => b.chave).filter((c): c is string => c !== null),
    })
  }

  return {
    totalGeral: resultados.reduce((s, r) => s + r.total, 0),
    estimado: resultados.some((r) => r.total > r.linhas.length),
    camadas: resultados.map((r) => indicadores(r.camada, r.total, r.linhas)),
    porUf,
    porPorte: distribuir(amostras, (l) => l.porte_rfb).map((b) =>
      fatia(b, b.chave ? (PORTE_LABELS[b.chave] ?? b.chave) : 'Porte não informado'),
    ),
    porTipo: distribuir(amostras, (l) => l.tipo).map((b) =>
      fatia(b, b.chave ? (TIPO_LABELS[b.chave] ?? b.chave) : 'Não classificada'),
    ),
  }
}
