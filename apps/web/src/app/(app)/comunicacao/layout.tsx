import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { ComunicacaoNav } from '@/components/comunicacao/comunicacao-nav'

/**
 * Casca do módulo Comunicação: inbox, fila de identificação, templates,
 * playbooks, painel de atividade e configurações.
 *
 * Nada aqui é admin-only ao nível da ROTA. O que é de administração são as
 * escritas de configuração e de playbook, e elas são barradas na action e no RPC
 * (`app_is_admin()`) — que é onde a autorização de verdade mora. Um gate de rota
 * esconderia a tela de quem precisa LER a janela de envio para entender por que a
 * mensagem dele ainda não saiu.
 */
export default async function ComunicacaoLayout({ children }: { children: ReactNode }) {
  const context = await requireSessionContext()
  if (!canAccessRoute('/comunicacao', context.grantedModuleIds)) redirect('/sem-acesso')

  return (
    <div>
      <ComunicacaoNav />
      {children}
    </div>
  )
}
