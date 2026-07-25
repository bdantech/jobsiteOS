import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { ClientesOnepay } from '@/components/radar/clientes-onepay'

export const metadata: Metadata = { title: 'Clientes Onepay — Radar' }

export default async function ClientesPage() {
  const { grantedModuleIds } = await requireSessionContext()
  if (!canAccessRoute('/radar/clientes', grantedModuleIds)) redirect('/sem-acesso')
  return <ClientesOnepay />
}
