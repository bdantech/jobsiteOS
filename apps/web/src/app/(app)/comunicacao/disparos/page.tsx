import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { DisparosConfig } from '@/components/antecipacao/disparos-config'

export const metadata: Metadata = { title: 'Disparos — Antecipação' }

export default async function DisparosPage() {
  const context = await requireSessionContext()
  if (!canAccessRoute('/antecipacao', context.grantedModuleIds) || !isAdmin(context)) {
    redirect('/sem-acesso')
  }
  return <DisparosConfig />
}
