import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { ComunicacaoNav } from '@/components/comunicacao/comunicacao-nav'

/**
 * Casca do módulo Comunicação: inbox, fila de identificação, templates,
 * playbooks, painel de atividade e configurações.
 *
 * O que é de administração são as escritas de configuração e de playbook, e elas
 * são barradas na action e no RPC (`app_is_admin()`) — que é onde a autorização
 * de verdade mora. Configurações continua aberta a todos de propósito: quem
 * precisa entender POR QUE a mensagem dele ainda não saiu tem de conseguir ler a
 * janela de envio.
 *
 * As duas exceções são Disparos e Contas WhatsApp, que vieram da Antecipação já
 * admin-only e continuam assim: mexer na régua ou no tipo de um número muda como
 * a casa inteira aparece para fora. Cada uma guarda de novo na própria página.
 */
export default async function ComunicacaoLayout({ children }: { children: ReactNode }) {
  const context = await requireSessionContext()
  if (!canAccessRoute('/comunicacao', context.grantedModuleIds)) redirect('/sem-acesso')

  return (
    <div>
      <ComunicacaoNav ehAdmin={isAdmin(context)} />
      {children}
    </div>
  )
}
