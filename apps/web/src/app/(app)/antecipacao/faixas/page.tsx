import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { RegrasFaixa } from '@/components/antecipacao/regras-faixa'

export const metadata: Metadata = { title: 'Regras de faixa — Antecipação' }

/**
 * Uma regra de faixa reclassifica o funil de todo mundo — é alavanca da empresa,
 * não preferência pessoal. Só admin, como a pirâmide. A RLS de `faixa_regras`
 * também exige app_is_admin() na escrita; aqui não abrimos a porta que não abre.
 */
export default async function FaixasPage() {
  const context = await requireSessionContext()
  if (!canAccessRoute('/antecipacao', context.grantedModuleIds) || !isAdmin(context)) {
    redirect('/sem-acesso')
  }
  return <RegrasFaixa />
}
