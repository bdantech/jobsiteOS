import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { contextoComercial } from '@/lib/comercial'
import { ComercialNav } from '@/components/comercial/comercial-nav'

/**
 * Casca do módulo Comercial. O tipo do vendedor é resolvido AQUI, no servidor, porque
 * ele decide quais abas existem — resolvê-lo no cliente faria a navegação piscar entre
 * dois conjuntos de abas em toda troca de página.
 */
export default async function ComercialLayout({ children }: { children: ReactNode }) {
  const { context, vendedor, ehGestor } = await contextoComercial()
  if (!canAccessRoute('/comercial', context.grantedModuleIds)) redirect('/sem-acesso')

  return (
    <div>
      <ComercialNav tipo={vendedor?.tipo ?? null} ehGestor={ehGestor} />
      {children}
    </div>
  )
}
