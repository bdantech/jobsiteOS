import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { DisparosConfig } from '@/components/antecipacao/disparos-config'

export const metadata: Metadata = { title: 'Disparos — Comunicação' }

/**
 * A régua vive na Comunicação porque é aqui que se lê o que ela produziu, mas o
 * componente continua em `components/antecipacao`: os dados são faixas, e faixa
 * é conceito da Antecipação. A tela mudou de menu, não de dono.
 */
export default async function DisparosPage() {
  const context = await requireSessionContext()
  if (!canAccessRoute('/comunicacao', context.grantedModuleIds) || !isAdmin(context)) {
    redirect('/sem-acesso')
  }
  return <DisparosConfig />
}
