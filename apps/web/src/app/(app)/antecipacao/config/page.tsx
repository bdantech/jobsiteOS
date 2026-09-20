import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { AntecipacaoConfig } from '@/components/antecipacao/antecipacao-config'
import { ProspeccaoConfig } from '@/components/antecipacao/prospeccao-config'

export const metadata: Metadata = { title: 'Configurações — Antecipação' }

export default async function AntecipacaoConfigPage() {
  const context = await requireSessionContext()
  if (!canAccessRoute('/antecipacao', context.grantedModuleIds) || !isAdmin(context)) {
    redirect('/sem-acesso')
  }
  /*
   * Dois blocos, duas TABELAS de configuração. `antecipacao_config` guarda a régua do
   * funil de notas; `prospeccao_config`, a do funil de sacados (04r §8). Um formulário
   * só teria de saber, campo a campo, qual RPC chamar.
   */
  return (
    <div className="space-y-6">
      <AntecipacaoConfig />
      <ProspeccaoConfig />
    </div>
  )
}
