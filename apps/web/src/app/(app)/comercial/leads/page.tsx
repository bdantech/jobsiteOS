import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { LeadsTela } from '@/components/leads/leads-tela'

export const metadata: Metadata = { title: 'Leads' }

export const dynamic = 'force-dynamic'

export default async function Pagina() {
  // Só gestor cria e edita formulário: um form publicado é uma URL na landing page de
  // um cliente, e trocar o slug depois quebra o que já está colado lá.
  const { ehGestor } = await contextoComercial()
  return <LeadsTela ehGestor={ehGestor} />
}
