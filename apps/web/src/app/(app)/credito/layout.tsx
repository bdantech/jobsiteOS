import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { CreditoNav } from '@/components/credito/credito-nav'

/**
 * Casca do módulo Crédito: esteira, painel, scorecard e configurações.
 *
 * Nada aqui é admin-only, ao contrário do Radar. O dono deste módulo é o perfil Crédito,
 * e as duas telas de ajuste (scorecard e configurações) são o trabalho dele — não um
 * painel de sistema. A autorização de verdade continua no RLS e nos RPCs.
 */
export default async function CreditoLayout({ children }: { children: ReactNode }) {
  const context = await requireSessionContext()
  if (!canAccessRoute('/credito', context.grantedModuleIds)) redirect('/sem-acesso')

  return (
    <div>
      <CreditoNav />
      {children}
    </div>
  )
}
