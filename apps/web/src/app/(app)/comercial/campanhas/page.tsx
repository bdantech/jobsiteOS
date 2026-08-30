import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { CampanhasLista } from '@/components/campanhas/campanhas-lista'

export const metadata: Metadata = { title: 'Campanhas — Comercial' }

// A lista mostra progresso de campanha em execução; estático congelaria o placar.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { ehGestor } = await contextoComercial()
  return <CampanhasLista podeGerir={ehGestor} />
}
