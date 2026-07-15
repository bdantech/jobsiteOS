/**
 * The Explorador subtree: data + components, self-contained.
 *
 * It carries its own api/queries/format rather than reaching into
 * `src/features/mercado/{api,queries}.ts` because those belong to the Mapa
 * surface and none of this is shared with it — and because the Grupo section
 * (§5.4) puts a Mercado component on the Company 360, so `empresas` will import
 * `mercado`: mercado importing back would close the cycle.
 */

export { CamadaFiltro, UfFiltro } from './chips'
export { ExploradorCard } from './explorador-card'
export { Field, FieldPair } from './field'
export { FiltroAtivo } from './filtro-ativo'
export { PromoverAcao } from './promover-acao'
export { SegmentosSheet } from './segmentos-sheet'
export { ExploradorListSkeleton, UniversoDetalheSkeleton } from './skeletons'
export { UniversoCadastro, UniversoSinais } from './universo-cadastro'
export { UniversoGrupo } from './universo-grupo'
export { UniversoHeader } from './universo-header'
export { UniversoObras } from './universo-obras'
export { UniversoSocios } from './universo-socios'

export {
  PAGE_SIZE,
  fetchExploradorPage,
  fetchSegmentos,
  fetchUniversoDetalhe,
  type ExploradorPage,
} from './api'

export {
  descreverArvore,
  exploradorKeys,
  promoverErrorMessage,
  segmentoArvore,
  useDebouncedValue,
  useExploradorQuery,
  usePromoverEmpresa,
  useSegmentosQuery,
  useUniversoQuery,
  type ExploradorResultado,
} from './queries'

export {
  UFS,
  camadaLabel,
  camadaVariant,
  formatData,
  formatM2,
  formatMoeda,
  formatNumero,
  formatTotal,
  idadeAnos,
  localizacao,
  porteLabel,
  situacaoLabel,
  situacaoObraVariant,
  situacaoVariant,
  tituloEmpresa,
} from './format'

export type {
  Camada,
  ExploradorFiltros,
  ExploradorListItem,
  ExploradorRow,
  FiltroArvore,
  FiltroComposto,
  GrupoEconomico,
  Metricas,
  Obra,
  OrigemFiltro,
  Segmento,
  Socio,
  UniversoDetalhe,
  UniversoRegistro,
} from './types'
