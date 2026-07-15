import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { EmpresaDetalhe } from '@/components/empresas/empresa-detalhe'

export const metadata: Metadata = {
  title: 'Empresa',
}

const uuidSchema = z.string().uuid()

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute(`/empresas/${id}`, grantedModuleIds)) redirect('/sem-acesso')

  // A non-uuid id is a 404, not a query: PostgREST would answer `.eq('id', 'abc')`
  // with 22P02 (invalid input syntax for uuid), which is an error state, not an
  // empty one — and it would surface as a red box instead of "não encontrada".
  if (!uuidSchema.safeParse(id).success) notFound()

  return <EmpresaDetalhe empresaId={id} />
}
