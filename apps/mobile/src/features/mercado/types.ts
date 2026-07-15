import type { Camada, Grupo as ArvoreFiltro, Tables, Views } from '@jobsiteos/core'

/**
 * `Grupo` in the filter engine is a NODE of the filter tree — nothing to do with
 * `grupos_economicos`. Two things called "grupo" in one feature is a bug waiting
 * to happen, so the tree is `ArvoreFiltro` everywhere on this side of the wire.
 */
export type { ArvoreFiltro }

/**
 * Every read in this module goes through `mercado_explorador` (migration 0012):
 * the universe LEFT JOIN empresas LEFT JOIN mercado_metricas, UNION ALL the
 * companies that never passed through staging. It is `security_invoker`, so RLS
 * decides the rows — the same rows the user could open by hand.
 *
 * Note the whole row is nullable-by-column: the view unions two sources, and a
 * staging row has no `estagio`/`erp_atual` while an imported row has no
 * `situacao_cadastral`. Never render one of these without a fallback.
 *
 * The Explorador's own list/filter/ficha types live next to its queries, in
 * components/explorador/types.ts. What stays here is what the Mapa and the grupo
 * need — plus this row type, which both sides derive their projections from.
 */
export type ExploradorRow = Views<'mercado_explorador'>

// ─── Mapa do Mercado ────────────────────────────────────────────────────────

export type IndicadorId =
  | 'com_erp'
  | 'com_contato'
  | 'com_obra_ativa'
  | 'madura'
  | 'capital_alto'

export interface IndicadorCamada {
  id: IndicadorId
  label: string
  descricao: string
  /** Absolute count of companies in this layer that match the indicator. */
  total: number
  /** Share of the LAYER (not of the universe), 0–100. */
  participacao: number
}

export interface ResumoCamada {
  camada: Camada
  label: string
  descricao: string
  total: number
  /** Share of the whole universe, 0–100 — so the four layers read as a pyramid. */
  participacao: number
  indicadores: IndicadorCamada[]
}

export interface ResumoPiramide {
  total: number
  camadas: ResumoCamada[]
}

// ─── Grupo econômico ────────────────────────────────────────────────────────

export type GrupoEconomico = Tables<'grupos_economicos'>

export type MembroGrupo = Pick<
  ExploradorRow,
  | 'cnpj'
  | 'razao_social'
  | 'nome_fantasia'
  | 'uf'
  | 'camada'
  | 'situacao_cadastral'
  | 'is_spe'
  | 'capital_social'
  | 'data_inicio_atividade'
  | 'obras_ativas'
  | 'empresa_id'
>

export interface SpesPorAno {
  ano: number
  total: number
}

export interface GrupoMetricas {
  /** Exact — a count query, not the length of the (capped) member list. */
  empresas_total: number
  /** Exact — a count query over the whole group. */
  empresas_com_obra: number
  /** Worker-computed, group-level (mercado_metricas.grupo_spes_total). */
  spes_total: number
  spes_24m: number
  ufs: string[]
  /** mercado_metricas.grupo_capital_agregado — null until the worker has run. */
  capital_agregado: number | null
  /** Derived from the members actually fetched; see `membros_truncados`. */
  spes_por_ano: SpesPorAno[]
}

export interface GrupoDetalhe {
  grupo: GrupoEconomico
  metricas: GrupoMetricas
  membros: MembroGrupo[]
  /** True when the group has more members than MEMBROS_LIMIT: say so in the UI. */
  membros_truncados: boolean
}
