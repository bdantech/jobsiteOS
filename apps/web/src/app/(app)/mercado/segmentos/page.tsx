import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { SegmentosLista } from '@/components/mercado/explorador/segmentos-lista'

export const metadata: Metadata = {
  title: 'Segmentos',
}

export default async function SegmentosPage() {
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/mercado/segmentos', grantedModuleIds)) redirect('/sem-acesso')

  return <SegmentosLista />
}
