import type { Metadata } from 'next'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { ScorecardEditor } from '@/components/credito/scorecard-editor'

export const metadata: Metadata = { title: 'Scorecard — Crédito' }

/**
 * webOnly de propósito (04d §7): é uma tela de calibragem com tabela de pesos e prévia
 * de distribuição. Espremer isso numa tela de 6" produziria uma versão pior das duas.
 */
export default async function ScorecardPage() {
  const context = await requireSessionContext()
  // A prévia de impacto lê `mercado_explorador`, gated por `app_tem_modulo('mercado')`.
  // O flag desce para a tela poder explicar a ausência em vez de mostrar uma prévia
  // vazia — que leria como "nada muda" bem na hora de ativar uma versão nova.
  return <ScorecardEditor podeVerMercado={canAccessRoute('/mercado', context.grantedModuleIds)} />
}
