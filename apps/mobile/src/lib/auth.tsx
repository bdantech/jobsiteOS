import { MODULES, type Tables } from '@jobsiteos/core'
import type { Session, User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { resetPushRegistration, unregisterPushNotifications } from '@/features/notificacoes/push'

import { supabase } from './supabase'

/**
 * The columns of `usuarios` that RLS actually grants to `authenticated`.
 * web_push_subscriptions / expo_push_tokens / prefs_notificacoes are NOT granted
 * on any row — not even your own — so they can never appear here. Reading or
 * writing them is a server (service-role) job, via the Next.js API.
 */
export type UsuarioSessao = Pick<
  Tables<'usuarios'>,
  'id' | 'nome' | 'email' | 'perfil_id' | 'ativo' | 'must_change_password' | 'criado_em'
>

const USUARIO_COLUMNS = 'id, nome, email, perfil_id, ativo, must_change_password, criado_em'

export interface SessionState {
  /** Supabase auth user. null when signed out. */
  user: User | null
  /** The `usuarios` row for that user. null while loading or when signed out. */
  usuario: UsuarioSessao | null
  /** Module ids the user's perfil grants. Drives tabs, guards and AI tools. */
  grantedModuleIds: string[]
  /** True until the first session + profile resolution finishes. */
  loading: boolean
  /** Re-reads usuarios + granted modules (e.g. after changing the password). */
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

/**
 * Granted modules, the only way a non-admin can learn them.
 *
 * `perfil_modulos` is admin-only under RLS (policy `perfil_modulos_admin`), so
 * selecting it as a regular user returns ZERO rows — no error, just an empty
 * list, which would silently strip every tab from every non-admin. The one
 * primitive `authenticated` may execute is app_tem_modulo(text) (SECURITY
 * DEFINER), so probe it once per registered module. The registry is small and
 * finite by construction, and this stays correct for admins too.
 */
async function fetchGrantedModuleIds(): Promise<string[]> {
  const results = await Promise.all(
    MODULES.map(async (module) => {
      const { data, error } = await supabase.rpc('app_tem_modulo', { p_modulo_id: module.id })
      if (error) throw error
      return data === true ? module.id : null
    }),
  )

  return results.filter((id): id is string => id !== null)
}

async function fetchUsuario(userId: string): Promise<UsuarioSessao | null> {
  const { data, error } = await supabase
    .from('usuarios')
    .select(USUARIO_COLUMNS)
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(null)
  const [grantedModuleIds, setGrantedModuleIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // Guards against a slow profile fetch for a session that is already gone.
  const currentUserId = useRef<string | null>(null)

  const load = useCallback(async (session: Session | null): Promise<void> => {
    const nextUser = session?.user ?? null
    currentUserId.current = nextUser?.id ?? null
    setUser(nextUser)

    if (!nextUser) {
      setUsuario(null)
      setGrantedModuleIds([])
      setLoading(false)
      return
    }

    try {
      const [row, modules] = await Promise.all([fetchUsuario(nextUser.id), fetchGrantedModuleIds()])
      if (currentUserId.current !== nextUser.id) return

      // A deactivated user keeps a valid JWT until it expires; RLS already
      // denies them every table, so end the session here rather than showing an
      // app-shaped shell full of empty states.
      if (row && !row.ativo) {
        await supabase.auth.signOut()
        return
      }

      setUsuario(row)
      setGrantedModuleIds(modules)
    } catch {
      if (currentUserId.current !== nextUser.id) return
      // Offline or RLS refusal: keep the auth user, expose no modules. The gate
      // sends them to the tabs shell, where every screen shows its error state.
      setUsuario(null)
      setGrantedModuleIds([])
    } finally {
      if (currentUserId.current === nextUser.id) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true

    void supabase.auth.getSession().then(({ data }) => {
      if (active) void load(data.session)
    })

    // Fires on SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED / USER_UPDATED.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      // A token refresh for the same user changes nothing we read here; skipping
      // it avoids a profile round-trip every hour.
      if (event === 'TOKEN_REFRESHED' && session?.user.id === currentUserId.current) return
      void load(session)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [load])

  const refresh = useCallback(async (): Promise<void> => {
    const { data } = await supabase.auth.getSession()
    await load(data.session)
  }, [load])

  const signOut = useCallback(async (): Promise<void> => {
    // A phone is a shared object, and a push token addresses the DEVICE, not the
    // account. Drop this device's token before the session goes away:
    // /api/push/expo authenticates the bearer token, so once signOut() has run
    // there is no credential left to make this call with, and the handset would
    // go on ringing for the account that just left.
    //
    // This belongs HERE, at the single choke point, not in the screens:
    //   - both sign-out surfaces (Configurações and the "Mais" tab) call this,
    //     and "Mais" was silently skipping it entirely;
    //   - the token must come from Expo itself. The Settings screen used a
    //     locally-stored token that is only ever populated when the user has
    //     touched the push switch — for everyone else it was null and the
    //     unregister call quietly did nothing.
    //
    // Best-effort: unregisterPushNotifications() swallows its own errors, because
    // a network failure must never trap someone in a session they are leaving.
    // If it does fail, the stale binding is still cleaned up server-side the next
    // time anyone registers this token (the route's cross-user purge).
    await unregisterPushNotifications()

    // Drop the "already registered this user" memo. It is module-level and
    // outlives the session, so without this a user signing back in during the
    // same app run would skip registration — having just had their token deleted.
    resetPushRegistration()

    await supabase.auth.signOut()
    // onAuthStateChange clears the rest.
  }, [])

  const value = useMemo<SessionState>(
    () => ({ user, usuario, grantedModuleIds, loading, refresh, signOut }),
    [user, usuario, grantedModuleIds, loading, refresh, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession precisa estar dentro de <SessionProvider>.')
  return context
}
