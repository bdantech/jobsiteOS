import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { AgentesNav } from '@/components/agentes/agentes-nav'

/**
 * Casca do módulo Agentes (Prompt 09 §11): Ao vivo · Mandatos · Personas · Materiais ·
 * Desempenho · Configurações.
 *
 * Ao vivo e Mandatos são de quem tem o módulo — o gestor vê todos os agentes, o closer vê
 * os agentes de que é o closer designado (a RLS recorta). Personas, Materiais, Desempenho e
 * Configurações são de gestor: a rota abre para os demais com um aviso, e o RPC recusa.
 */
export default async function AgentesLayout({ children }: { children: ReactNode }) {
  const context = await requireSessionContext()
  if (!canAccessRoute('/agentes', context.grantedModuleIds)) redirect('/sem-acesso')

  return (
    <div>
      <AgentesNav />
      {children}
    </div>
  )
}
