import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { EmpresasLista } from '@/components/empresas/empresas-lista'

export const metadata: Metadata = {
  title: 'Empresas',
}

/**
 * The registry is the guard: `canAccessRoute` resolves /empresas to the
 * `empresas` module and checks it against the perfil's grants — the same call
 * the sidebar and the AI tool list make. RLS would already return zero rows to
 * an ungranted user; this is what turns that into an honest page instead of an
 * empty table.
 */
export default async function EmpresasPage() {
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/empresas', grantedModuleIds)) redirect('/sem-acesso')

  return <EmpresasLista />
}
