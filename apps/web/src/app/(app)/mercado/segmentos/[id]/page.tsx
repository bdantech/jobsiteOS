import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { SegmentoDetalhe } from '@/components/mercado/explorador/segmento-detalhe'

export const metadata: Metadata = {
  title: 'Segmento',
}

const uuidSchema = z.string().uuid()

/** É a rota que `mercado.criar_segmento` devolve para a IA — precisa existir. */
export default async function SegmentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/mercado/segmentos', grantedModuleIds)) redirect('/sem-acesso')

  // Um id que não é uuid faria o PostgREST devolver 22P02 (erro), não vazio —
  // uma caixa vermelha onde o certo é "não encontrado".
  if (!uuidSchema.safeParse(id).success) notFound()

  return <SegmentoDetalhe segmentoId={id} />
}
