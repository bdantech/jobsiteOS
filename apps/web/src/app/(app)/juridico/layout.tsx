import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { JuridicoNav } from '@/components/juridico/juridico-nav'

/**
 * Casca do módulo Jurídico: processos, painel, prazos e configurações.
 *
 * Nada aqui é admin-only ao nível da rota — o dono do módulo é o perfil Jurídico. O que
 * é de administração são as ESCRITAS de configuração, e elas são barradas na action e
 * no RPC, que é onde a autorização de verdade mora.
 */
export default async function JuridicoLayout({ children }: { children: ReactNode }) {
  const context = await requireSessionContext()
  if (!canAccessRoute('/juridico', context.grantedModuleIds)) redirect('/sem-acesso')

  return (
    <div>
      <JuridicoNav />
      {children}
    </div>
  )
}
