import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { CampanhaDetalhe } from '@/components/campanhas/detalhe'

export const metadata: Metadata = { title: 'Campanha — Comercial' }
export const dynamic = 'force-dynamic'

export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { ehGestor } = await contextoComercial()
  return <CampanhaDetalhe id={id} podeGerir={ehGestor} />
}
