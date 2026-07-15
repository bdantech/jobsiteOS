import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { NotificacoesPagina } from '@/components/notifications/notificacoes-pagina'

export const metadata: Metadata = {
  title: 'Notificações',
}

export default async function Page() {
  const { grantedModuleIds } = await requireSessionContext()

  // Registry-driven guard: the sidebar already hides ungranted modules, but the
  // route has to enforce it too — hiding a link is not access control.
  if (!canAccessRoute('/notificacoes', grantedModuleIds)) notFound()

  // The list itself is client-rendered: it holds a live Realtime subscription and
  // shares one query cache with the bell, so server-fetching it would only add a
  // payload that the client immediately re-fetches anyway.
  return <NotificacoesPagina />
}
