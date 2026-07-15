/**
 * The grupo econômico components: the screen at `/mercado/grupos/<id>` and the
 * "Grupo" section of the Company 360.
 *
 * Components ONLY. The data (fetchGrupo, useGrupoQuery, GrupoDetalhe) lives in
 * the feature's shared layer — src/features/mercado/{api,queries,types,format}.ts
 * — which the Mapa and the Explorador read too. A second fetchGrupo here would be
 * a second answer to "how many SPEs does this group have", and the 360 card and
 * the group screen would eventually disagree.
 */
export { GrupoHeader } from './grupo-header'
export { GrupoMetricas } from './grupo-metricas'
export { GrupoSection } from './grupo-section'
export { MembroCard } from './membro-card'
export { GrupoSectionSkeleton, GrupoSkeleton } from './skeletons'
export { SpesPorAnoChart } from './spes-por-ano-chart'
export { situacaoLabel, situacaoVariant } from './situacao'
