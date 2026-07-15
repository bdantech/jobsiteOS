import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { MODULE_IDS } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The usuarios columns `authenticated` is actually granted (migration 0005).
 * Deliberately NOT Tables<'usuarios'>: that Row type includes
 * web_push_subscriptions / expo_push_tokens / prefs_notificacoes, which must
 * never travel to a client component. Keeping them out of the type keeps them
 * out of the props you can accidentally pass down.
 */
export interface SessionUsuario {
  id: string
  nome: string
  email: string
  perfil_id: string | null
  ativo: boolean
  must_change_password: boolean
  criado_em: string
}

export interface SessionContext {
  user: User
  usuario: SessionUsuario
  /** AppModule ids this user's perfil grants. The single input to every RBAC decision. */
  grantedModuleIds: string[]
}

/**
 * Identity + permissions for the current request. Every page, server action and
 * the AI route funnels its RBAC through this.
 *
 * Returns null when there is no valid session, when the usuarios row is missing
 * (auth user created but never linked), or when the account is deactivated —
 * callers must treat all three as "not logged in".
 *
 * WHY THE SERVICE-ROLE CLIENT: `perfil_modulos` and `perfis` are gated by
 * `app_is_admin()` under RLS (migration 0002), so a non-admin reading their own
 * grants with the user-scoped client gets zero rows — i.e. a silently
 * permission-less session. There is no RPC that exposes "my modules". So we
 * verify identity with the user-scoped client (getUser() revalidates the JWT
 * against the auth server) and only then use the admin client to read that one
 * user's own row and their perfil's modules. The escalation is scoped to
 * `user.id` and nothing derived from client input is used in the lookup.
 *
 * Memoised per request with React `cache`, so a layout + page + action in the
 * same render do one round trip, not three.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) return null

  const admin = createAdminClient()

  const { data: usuario, error: usuarioError } = await admin
    .from('usuarios')
    .select('id, nome, email, perfil_id, ativo, must_change_password, criado_em')
    .eq('id', user.id)
    .maybeSingle()

  // A deactivated user keeps a technically valid JWT until it expires. Treat
  // them as logged out here, so deactivation takes effect on the next request
  // rather than whenever the token happens to lapse.
  if (usuarioError || !usuario || !usuario.ativo) return null

  let grantedModuleIds: string[] = []

  if (usuario.perfil_id) {
    const { data: modulos, error: modulosError } = await admin
      .from('perfil_modulos')
      .select('modulo_id')
      .eq('perfil_id', usuario.perfil_id)

    if (modulosError) {
      throw new Error(`Falha ao carregar permissões do usuário: ${modulosError.message}`)
    }

    // Intersect with the registry: it is the source of truth for what a module
    // *is*. A modulo_id left behind in the DB by a removed module must not grant
    // anything, and must not appear in the sidebar as a dead link.
    grantedModuleIds = (modulos ?? [])
      .map((m) => m.modulo_id)
      .filter((id) => MODULE_IDS.includes(id))
  }

  return { user, usuario, grantedModuleIds }
})

/**
 * Same, but bounces anonymous/deactivated callers to /login instead of returning
 * null. Use this at the top of any protected page or server action.
 */
export async function requireSessionContext(): Promise<SessionContext> {
  const context = await getSessionContext()
  if (!context) redirect('/login')
  return context
}

/** The `admin` module is what makes someone an admin — same rule as app_is_admin(). */
export function isAdmin(context: SessionContext): boolean {
  return context.grantedModuleIds.includes('admin')
}
