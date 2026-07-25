import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { LoteDetalhe } from '@/components/radar/lote-detalhe'

export const metadata: Metadata = { title: 'Lote — Radar' }

export default async function LotePage({ params }: { params: Promise<{ id: string }> }) {
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/radar/lotes', grantedModuleIds)) redirect('/sem-acesso')

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) notFound()

  return <LoteDetalhe id={id} />
}
