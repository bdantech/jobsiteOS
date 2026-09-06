import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/auth'
import { contextoComercial } from '@/lib/comercial'
import { LeadsTela } from '@/components/leads/leads-tela'

export const metadata: Metadata = { title: 'Leads' }

export const dynamic = 'force-dynamic'

/**
 * Só Admin. Um formulário publicado é uma URL colada na landing page de um cliente, e
 * trocar o slug depois quebra o que já está lá fora — decisão de aquisição, não de
 * funil. A guarda é na PÁGINA e não só no menu: esconder o item não impede ninguém de
 * digitar a rota.
 */
export default async function Pagina() {
  const { context } = await contextoComercial()
  if (!isAdmin(context)) redirect('/comercial')
  return <LeadsTela ehGestor />
}
