import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { Explorador } from '@/components/mercado/explorador/explorador'
import CarregandoExplorador from './loading'

export const metadata: Metadata = {
  title: 'Explorador',
}

/**
 * Guarda fina, igual à de /empresas: o registry resolve /mercado/explorador para
 * o módulo `mercado` (match por prefixo) e confere contra os grants do perfil. O
 * RLS já devolveria zero linhas para quem não tem o módulo — isto é o que
 * transforma isso em uma página honesta em vez de uma tabela vazia.
 *
 * O <Suspense> existe porque o Explorador lê `useSearchParams()`: sem uma
 * fronteira, o Next recusa pré-renderizar a rota.
 */
export default async function ExploradorPage() {
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/mercado/explorador', grantedModuleIds)) redirect('/sem-acesso')

  return (
    <Suspense fallback={<CarregandoExplorador />}>
      <Explorador />
    </Suspense>
  )
}
