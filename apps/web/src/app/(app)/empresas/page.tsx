import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { EmpresasTabs } from '@/components/empresas/empresas-tabs'

export const metadata: Metadata = {
  title: 'Empresas',
}

/**
 * The registry is the guard: `canAccessRoute` resolves /empresas to the
 * `empresas` module and checks it against the perfil's grants — the same call
 * the sidebar and the AI tool list make. RLS would already return zero rows to
 * an ungranted user; this is what turns that into an honest page instead of an
 * empty table.
 *
 * Três abas (Empresas / Clientes Onepay / Análise). As duas últimas leem dados do
 * Radar, então passamos `temRadar` para a UI mostrar um estado amigável a quem não
 * tem o módulo — o RLS já protege o dado; isto só evita uma tela vazia sem explicação.
 */
export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/empresas', grantedModuleIds)) redirect('/sem-acesso')

  const { tab } = await searchParams
  const temRadar = canAccessRoute('/radar', grantedModuleIds)

  return <EmpresasTabs temRadar={temRadar} abaInicial={tab} />
}
