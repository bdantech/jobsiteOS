import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { RadarConfig } from '@/components/radar/radar-config'

export const metadata: Metadata = { title: 'Configurações — Radar' }

export default async function RadarConfigPage() {
  const context = await requireSessionContext()
  // Config é company-wide (custos, orçamento) — só admin. A RLS de radar_config
  // também exige app_is_admin() na escrita; aqui evitamos abrir a porta que não abre.
  if (!canAccessRoute('/radar/config', context.grantedModuleIds) || !isAdmin(context)) redirect('/sem-acesso')
  return <RadarConfig />
}
