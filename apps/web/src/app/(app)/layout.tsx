import { redirect } from 'next/navigation'
import { AppShell } from '@/components/shell/app-shell'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The authenticated shell. Every module page lives under this route group, so every module
 * page gets the sidebar, the tab bar, the AI Bar and the notifications bell for free —
 * a new module ships zero layout code.
 *
 * Guards here are defence in depth, not the primary gate (src/middleware.ts is), because a
 * middleware matcher is one regex away from being wrong and this layout cannot be bypassed
 * by any request that renders a page inside it:
 *  - no session / deactivated user → requireSessionContext() redirects to /login;
 *  - must_change_password → nothing else in the app is reachable first.
 *
 * Per-route RBAC (canAccessRoute) is not enforced here: this layout does not know the
 * pathname. Ungranted modules are absent from the sidebar and blocked by the middleware.
 */
/**
 * Os atalhos que a pessoa fixou no topo da sidebar (0284). A coluna não tem grant para
 * `authenticated` — como `prefs_notificacoes` —, então a leitura é pelo service role,
 * presa ao id da sessão revalidada. Falhar aqui não derruba o app: sem a lista, a
 * sidebar só não mostra a seção "Fixados".
 */
async function carregarAtalhos(userId: string): Promise<string[]> {
  const { data } = await createAdminClient()
    .from('usuarios')
    .select('atalhos_fixados')
    .eq('id', userId)
    .maybeSingle()
  return data?.atalhos_fixados ?? []
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await requireSessionContext()
  const { usuario, grantedModuleIds } = context

  if (usuario.must_change_password) redirect('/alterar-senha')

  const atalhos = await carregarAtalhos(context.user.id)

  return (
    <AppShell
      // Deliberately narrowed: the shell is a client component, so anything passed here is
      // serialised into the HTML. It gets identity and nothing else — no perfil_id, no
      // push subscriptions, no notification prefs.
      usuario={{ id: usuario.id, nome: usuario.nome, email: usuario.email }}
      grantedModuleIds={grantedModuleIds}
      atalhos={atalhos}
      ehAdmin={isAdmin(context)}
    >
      {children}
    </AppShell>
  )
}
