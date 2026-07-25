import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { RadarPainel } from '@/components/radar/radar-painel'

export const metadata: Metadata = { title: 'Radar' }

export default async function RadarPage() {
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/radar', grantedModuleIds)) redirect('/sem-acesso')

  return <RadarPainel />
}
