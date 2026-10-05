import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { AntecipacaoNav } from '@/components/antecipacao/antecipacao-nav'

/**
 * Casca do módulo Antecipação. Quem é admin é resolvido no servidor pelo layout de
 * (app): as telas que mexem na RÉGUA (faixas, settings) só são oferecidas a admins,
 * e cada página também guarda. A autorização de verdade continua na página + RLS.
 */
export default async function AntecipacaoLayout({ children }: { children: ReactNode }) {
  const context = await requireSessionContext()
  if (!canAccessRoute('/antecipacao', context.grantedModuleIds)) redirect('/sem-acesso')

  return (
    <div>
      <AntecipacaoNav />
      {children}
    </div>
  )
}
