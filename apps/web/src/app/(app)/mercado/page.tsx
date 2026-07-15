import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { MapaMercado } from '@/components/mercado/mapa/mapa-mercado'

export const metadata: Metadata = {
  title: 'Mapa do Mercado',
}

/**
 * Same guard as every other module page: the registry resolves /mercado to the
 * `mercado` module and checks it against the perfil's grants. RLS
 * (`app_tem_modulo('mercado')`) would already return zero rows to an ungranted
 * user — this is what turns that into an honest redirect instead of a dashboard
 * that reports an empty market.
 */
export default async function MercadoPage() {
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/mercado', grantedModuleIds)) redirect('/sem-acesso')

  return <MapaMercado />
}
