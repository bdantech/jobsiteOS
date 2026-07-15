import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { MercadoNav } from '@/components/mercado/mercado-nav'

/**
 * Casca do módulo Mercado: a navegação entre suas sete telas.
 *
 * O shell de (app) só entrega a navegação de PRIMEIRO nível — o registry rende um
 * item de sidebar por módulo. Dentro de um módulo com várias telas, alguém precisa
 * ligá-las, e esse alguém é este layout.
 *
 * `ehAdmin` é resolvido aqui, no servidor, e não dentro do componente de nav: a tela
 * de Camadas redireciona não-admins para /sem-acesso, então oferecer o link a eles
 * seria oferecer uma porta que bate na cara. A decisão de autorização continua
 * sendo da página (e do RLS) — isto só evita mostrar o que não vai abrir.
 */
export default async function MercadoLayout({ children }: { children: ReactNode }) {
  const context = await requireSessionContext()
  if (!canAccessRoute('/mercado', context.grantedModuleIds)) redirect('/sem-acesso')

  return (
    <div>
      <MercadoNav ehAdmin={isAdmin(context)} />
      {children}
    </div>
  )
}
