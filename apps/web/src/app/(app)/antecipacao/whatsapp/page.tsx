import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { WhatsappContas } from '@/components/antecipacao/whatsapp-contas'

export const metadata: Metadata = { title: 'Contas WhatsApp — Antecipação' }

export default async function WhatsappPage() {
  const context = await requireSessionContext()
  if (!canAccessRoute('/antecipacao', context.grantedModuleIds) || !isAdmin(context)) {
    redirect('/sem-acesso')
  }
  return <WhatsappContas />
}
