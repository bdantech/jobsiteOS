import type { Camada, Grupo as FiltroArvore, Tables, Views } from '@jobsiteos/core'

/**
 * Every read in the Explorador goes through `mercado_explorador` (migration
 * 0012): staging ∪ promoted empresas, security_invoker, so RLS decides the rows.
 * Never query `mercado_universo` and `empresas` separately and stitch them here —
 * the view exists precisely so the two surfaces cannot drift.
 */
export type ExploradorRow = Views<'mercado_explorador'>

/**
 * The columns the list actually paints. `select('*')` over a table with millions
 * of rows is wasted bytes on 4G.
 *
 * `cnpj` is narrowed to non-null: it is `not null` in both base tables, but the
 * generated type widens every view column to nullable. Narrowing here (api.ts
 * filters the rows) keeps a `?? ''` fallback out of every component and out of
 * the FlatList key.
 */
export type ExploradorListItem = Omit<
  Pick<
    ExploradorRow,
    | 'cnpj'
    | 'razao_social'
    | 'nome_fantasia'
    | 'uf'
    | 'municipio'
    | 'camada'
    | 'estagio'
    | 'capital_social'
    | 'is_spe'
    | 'obras_ativas'
    | 'erp_atual'
    | 'grupo_id'
    | 'empresa_id'
  >,
  'cnpj'
> & { cnpj: string }

/** What the composite filter came from — the pill has to say which. */
export type OrigemFiltro =
  /** `id`, not `nome`: `segmentos.nome` is not unique, so a name is not an identity. */
  | { tipo: 'segmento'; id: string; nome: string }
  /** Deep link from the Mapa: a slice of a chart, already compiled into a tree. */
  | { tipo: 'mapa' }

export interface FiltroComposto {
  arvore: FiltroArvore
  origem: OrigemFiltro
}

/**
 * `undefined` camada / uf = no filter (the "Todas" chip).
 *
 * `filtro` is the composite tree — from a saved segmento or from a Mapa deep
 * link. It is ANDed with the chips and the search term, never merged into them.
 */
export interface ExploradorFiltros {
  termo: string
  camada?: Camada
  uf?: string
  filtro?: FiltroComposto
}

export type Segmento = Tables<'segmentos'>
export type Socio = Tables<'mercado_socios'>
export type Obra = Tables<'mercado_obras'>
export type UniversoRegistro = Tables<'mercado_universo'>
export type GrupoEconomico = Tables<'grupos_economicos'>
export type Metricas = Tables<'mercado_metricas'>

/** Everything the universe sheet paints, in one round of parallel reads. */
export interface UniversoDetalhe {
  universo: UniversoRegistro
  /** Written by the worker. Absent until the first metrics run touches this CNPJ. */
  metricas: Metricas | null
  socios: Socio[]
  obras: Obra[]
  grupo: GrupoEconomico | null
  /** Members of the group, counted on the view (so RLS applies). 0 when no group. */
  grupoMembros: number
}

export type { Camada, FiltroArvore }
