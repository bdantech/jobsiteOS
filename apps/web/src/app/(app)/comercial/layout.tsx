import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ComercialNav } from '@/components/comercial/comercial-nav'

/**
 * Casca do módulo Comercial. O tipo do vendedor é resolvido AQUI, no servidor, porque
 * ele decide quais abas existem — resolvê-lo no cliente faria a navegação piscar entre
 * dois conjuntos de abas em toda troca de página.
 */
export default async function ComercialLayout({ children }: { children: ReactNode }) {
  const context = await requireSessionContext()
  if (!canAccessRoute('/comercial', context.grantedModuleIds)) redirect('/sem-acesso')

  const supabase = await createClient()
  const { data: vendedor } = await supabase
    .from('vendedores')
    .select('tipo')
    .eq('usuario_id', context.usuario.id)
    .eq('ativo', true)
    .maybeSingle()

  // Gestor = quem administra o módulo. `admin` é o superconjunto; quem tem o módulo
  // `comercial` sem ser vendedor cadastrado também é gestor na prática — é o perfil
  // Comercial, que existe justamente para isso.
  const ehGestor = isAdmin(context) || !vendedor

  return (
    <div>
      <ComercialNav tipo={vendedor?.tipo ?? null} ehGestor={ehGestor} />
      {children}
    </div>
  )
}
