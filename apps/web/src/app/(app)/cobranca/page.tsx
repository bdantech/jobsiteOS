import type { Metadata } from 'next'
import { requireSessionContext } from '@/lib/auth'
import { PainelCobranca } from '@/components/cobranca/painel'

export const metadata: Metadata = { title: 'Painel — Cobrança' }

/**
 * O id de quem abre vem do servidor: é ele que liga o filtro "minhas cobranças" do
 * relógio para quem não é gestor, sem uma ida extra ao banco no navegador.
 */
export default async function CobrancaPainelPage() {
  const context = await requireSessionContext()
  return <PainelCobranca usuarioId={context.usuario.id} />
}
