import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { SupressaoLista } from '@/components/radar/supressao-lista'

export const metadata: Metadata = { title: 'Supressão — Radar' }

export default async function SupressaoPage() {
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/radar/supressao', grantedModuleIds)) redirect('/sem-acesso')
  return <SupressaoLista />
}
