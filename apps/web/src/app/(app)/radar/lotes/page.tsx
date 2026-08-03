import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { LotesLista } from '@/components/radar/lotes-lista'

export const metadata: Metadata = { title: 'Enriquecimento — Radar' }

export default async function LotesPage() {
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/radar/lotes', grantedModuleIds)) redirect('/sem-acesso')
  return <LotesLista />
}
