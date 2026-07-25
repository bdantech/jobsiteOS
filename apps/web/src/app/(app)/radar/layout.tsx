import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { RadarNav } from '@/components/radar/radar-nav'

/**
 * Casca do módulo Radar: navegação entre as telas (Painel, Lotes, Clientes,
 * Supressão, Configurações). ehAdmin é resolvido no servidor — Config só é oferecida
 * a admins (a página também guarda). A autorização de verdade continua na página + RLS.
 */
export default async function RadarLayout({ children }: { children: ReactNode }) {
  const context = await requireSessionContext()
  if (!canAccessRoute('/radar', context.grantedModuleIds)) redirect('/sem-acesso')

  return (
    <div>
      <RadarNav ehAdmin={isAdmin(context)} />
      {children}
    </div>
  )
}
