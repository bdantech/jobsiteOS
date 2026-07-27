import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { AntecipacaoConfig } from '@/components/antecipacao/antecipacao-config'

export const metadata: Metadata = { title: 'Configurações — Antecipação' }

export default async function AntecipacaoConfigPage() {
  const context = await requireSessionContext()
  if (!canAccessRoute('/antecipacao', context.grantedModuleIds) || !isAdmin(context)) {
    redirect('/sem-acesso')
  }
  return <AntecipacaoConfig />
}
