// The Mercado feature surface.
//
// This barrel is the MAPA + GRUPO half of the module, plus the format vocabulary
// and the cache root every Mercado query hangs off (`mercadoKeys`).
//
// The Explorador and the ficha do universo are a self-contained subtree with
// their own reads, cached under `mercadoKeys.all` via `exploradorKeys`. Import
// them from '@/features/mercado/components/explorador' — NOT from here. There is
// exactly one fetcher and one hook per surface, and exactly one
// `usePromoverEmpresa` (the Explorador's), so a promotion always invalidates the
// same caches.

export { CamadaCard } from './components/mapa/camada-card'
export { MapaSkeleton } from './components/mapa/mapa-skeleton'
export { PiramideChart } from './components/mapa/piramide-chart'

export { INDICADORES_MAPA, MEMBROS_LIMIT, fetchGrupo, fetchResumoPiramide } from './api'

export { mercadoKeys, useGrupoQuery, useResumoPiramideQuery } from './queries'

export {
  CAMADA_CHART,
  anoDe,
  camadaDescricao,
  camadaLabel,
  camadaVariant,
  formatArea,
  formatCnpj,
  formatData,
  formatInteiro,
  formatMoeda,
  formatMoedaCompacta,
  formatPercentual,
  idadeAnos,
  localizacao,
  participacao,
  registroRota,
  registroTitulo,
} from './format'

export type {
  ArvoreFiltro,
  ExploradorRow,
  GrupoDetalhe,
  GrupoEconomico,
  GrupoMetricas,
  IndicadorCamada,
  IndicadorId,
  MembroGrupo,
  ResumoCamada,
  ResumoPiramide,
  SpesPorAno,
} from './types'
