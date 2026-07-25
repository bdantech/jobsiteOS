import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { NovoLote } from '@/components/radar/novo-lote'

export const metadata: Metadata = { title: 'Novo lote — Radar' }

export default async function NovoLotePage() {
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/radar/lotes', grantedModuleIds)) redirect('/sem-acesso')
  return <NovoLote />
}
