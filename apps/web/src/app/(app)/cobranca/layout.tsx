import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { CobrancaNav } from '@/components/cobranca/cobranca-nav'

/**
 * Casca do módulo Cobrança: painel, cobranças, sinistros, protestos, modelos e config.
 *
 * Nada aqui é de gestor ao nível da rota: o operador abre todas as abas. O que é de
 * gestão (números consolidados, modelos, settings, regularizar o sacado) é barrado na
 * action e no RPC — a tela só esconde o botão.
 */
export default async function CobrancaLayout({ children }: { children: ReactNode }) {
  const context = await requireSessionContext()
  if (!canAccessRoute('/cobranca', context.grantedModuleIds)) redirect('/sem-acesso')

  return (
    <div>
      <CobrancaNav />
      {children}
    </div>
  )
}
