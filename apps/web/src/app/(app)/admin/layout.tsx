import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireSessionContext, isAdmin } from '@/lib/auth'
import { AdminNav } from '@/components/admin/admin-nav'

export const metadata: Metadata = {
  title: 'Administração',
}

/**
 * Second lock on the whole /admin subtree.
 *
 * The middleware already refuses routes the perfil does not grant (canAccessRoute
 * from the registry), but a layout guard is cheap and this is the one module
 * where a routing mistake hands over the service role. A non-admin who somehow
 * gets here is bounced, and every server action re-checks independently — none
 * of them trusts this layout.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const context = await requireSessionContext()

  if (!isAdmin(context)) redirect('/sem-acesso')

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Administração</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie os usuários da ONE OS e os perfis de acesso aos módulos.
        </p>
      </header>

      <AdminNav />

      {children}
    </div>
  )
}
