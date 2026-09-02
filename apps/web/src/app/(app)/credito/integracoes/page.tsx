import type { Metadata } from 'next'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { Integracoes } from '@/components/credito/integracoes'

export const metadata: Metadata = { title: 'Integrações — Crédito' }

/**
 * `webOnly`, como o 04n pede: é uma tela de configuração de integração, não de
 * operação. Quem administra chave de API está sentado.
 */
export const dynamic = 'force-dynamic'

export default async function IntegracoesPage() {
  const context = await requireSessionContext()
  // A tela é do módulo Crédito (o layout já barra quem não tem); criar e revogar
  // CHAVE é de admin, e o RPC repete a checagem — aqui é a camada de oferta.
  return <Integracoes ehAdmin={isAdmin(context)} />
}
