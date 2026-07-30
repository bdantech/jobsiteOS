import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { EstimadorPainel } from '@/components/radar/estimador-painel'

export const metadata: Metadata = { title: 'Estimador — Radar' }

/**
 * webOnly de propósito (04c §8): é uma tela de auditoria de modelo, com tabela de
 * coeficientes. Não é o tipo de coisa que se lê no celular entre uma visita e outra —
 * e tentar espremer isso numa tela de 6" produziria uma versão pior de ambas.
 *
 * Não é admin-only, ao contrário de Configurações: ver COMO a estimativa foi feita é
 * o que torna o número usável numa conversa comercial. Quem pode ver o número tem de
 * poder ver a procedência dele.
 */
export default async function EstimadorPage() {
  const context = await requireSessionContext()
  if (!canAccessRoute('/radar', context.grantedModuleIds)) redirect('/sem-acesso')
  return <EstimadorPainel />
}
