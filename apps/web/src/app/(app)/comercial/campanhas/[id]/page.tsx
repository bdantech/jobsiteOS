import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/auth'
import { contextoComercial } from '@/lib/comercial'
import { CampanhaDetalhe } from '@/components/campanhas/detalhe'

export const metadata: Metadata = { title: 'Campanha — Comercial' }
export const dynamic = 'force-dynamic'

export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { context } = await contextoComercial()
  if (!isAdmin(context)) redirect('/comercial')
  return <CampanhaDetalhe id={id} podeGerir />
}
