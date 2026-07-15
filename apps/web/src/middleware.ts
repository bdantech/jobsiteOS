import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { canAccessRoute, MODULE_IDS, type Database } from '@jobsiteos/core'
import { updateSession } from '@/lib/supabase/middleware'

/**
 * The single gate in front of the app. Four jobs, in this order:
 *
 *   1. Refresh the Supabase session cookie (updateSession).
 *   2. Anonymous            → /login
 *   3. must_change_password → /alterar-senha, and NOTHING else gets through.
 *   4. Module RBAC          → canAccessRoute(pathname, grantedModuleIds).
 *
 * Pages and server actions still re-check with requireSessionContext(): the
 * middleware is a guard, not the authorization boundary. RLS in Postgres is.
 */

const LOGIN_ROUTE = '/login'
const TROCA_SENHA_ROUTE = '/alterar-senha'

/**
 * The service-role client is built inline here instead of importing
 * lib/supabase/admin.ts, which carries `import 'server-only'`. Middleware is
 * compiled for the edge runtime, where that import is not guaranteed to resolve
 * to its no-op branch — it can throw at module load. This client is fetch-based
 * and edge-safe, and the key never leaves the server bundle.
 */
function createEdgeAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

interface Conta {
  ativo: boolean
  mustChangePassword: boolean
  grantedModuleIds: string[]
}

/**
 * WHY THE SERVICE ROLE: `perfil_modulos` is admin-gated under RLS (migration
 * 0002), so a non-admin reading their own grants with the user-scoped client
 * gets zero rows — a silently permission-less session that would 403 out of
 * every module. Same reasoning as lib/auth.ts. The lookup is pinned to the
 * `userId` from the JWT that updateSession() just revalidated; nothing derived
 * from client input reaches this query.
 */
async function carregarConta(userId: string): Promise<Conta | null> {
  const admin = createEdgeAdminClient()

  const { data: usuario, error } = await admin
    .from('usuarios')
    .select('ativo, must_change_password, perfil_id')
    .eq('id', userId)
    .maybeSingle()

  // Fail closed: a DB blip must lock the door, not open it.
  if (error || !usuario) return null

  let grantedModuleIds: string[] = []

  if (usuario.perfil_id) {
    const { data: modulos, error: modulosError } = await admin
      .from('perfil_modulos')
      .select('modulo_id')
      .eq('perfil_id', usuario.perfil_id)

    if (modulosError) return null

    // Intersect with the registry: a modulo_id left in the DB by a deleted
    // module must not grant access to anything.
    grantedModuleIds = (modulos ?? [])
      .map((m) => m.modulo_id)
      .filter((id) => MODULE_IDS.includes(id))
  }

  return {
    ativo: usuario.ativo ?? false,
    mustChangePassword: usuario.must_change_password ?? false,
    grantedModuleIds,
  }
}

/**
 * Carries the cookies updateSession() refreshed onto whatever response we end up
 * returning. Forgetting this on a redirect drops the rotated refresh token and
 * logs the user out at random — the classic Supabase-SSR footgun.
 */
function comCookies(origem: NextResponse, destino: NextResponse): NextResponse {
  for (const cookie of origem.cookies.getAll()) destino.cookies.set(cookie)
  return destino
}

function redirecionar(request: NextRequest, pathname: string, base: NextResponse): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  url.search = ''
  return comCookies(base, NextResponse.redirect(url))
}

/** Deactivated mid-session: drop the session cookies so the JWT can't be reused. */
function expulsar(request: NextRequest, motivo: 'desativado' | 'sessao'): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = LOGIN_ROUTE
  url.search = motivo === 'desativado' ? '?erro=desativado' : ''

  const response = NextResponse.redirect(url)
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith('sb-')) response.cookies.delete(cookie.name)
  }
  return response
}

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  const isLogin = pathname === LOGIN_ROUTE

  if (!user) {
    if (isLogin) return response
    return redirecionar(request, LOGIN_ROUTE, response)
  }

  const conta = await carregarConta(user.id)

  // No usuarios row, or deactivated since the token was issued. Deactivation
  // takes effect on the very next request instead of whenever the JWT lapses.
  if (!conta) return expulsar(request, 'sessao')
  if (!conta.ativo) return expulsar(request, 'desativado')

  if (conta.mustChangePassword) {
    // The whole app is closed until the temporary password is replaced.
    if (pathname === TROCA_SENHA_ROUTE) return response
    return redirecionar(request, TROCA_SENHA_ROUTE, response)
  }

  // Already signed in and nothing pending — the login screen has nothing to offer.
  if (isLogin) return redirecionar(request, '/', response)

  // Nothing left to force: this screen is done.
  if (pathname === TROCA_SENHA_ROUTE) return redirecionar(request, '/', response)

  // Registry-driven RBAC. Routes outside any module (/settings, /) return true,
  // so this only ever blocks a real module route.
  if (!canAccessRoute(pathname, conta.grantedModuleIds)) {
    // "/" resolves the first module this user CAN see (and explains itself when
    // the perfil grants none), so an ungranted deep link degrades into a sane
    // landing instead of a dead end. No loop: "/" is not a module route.
    return redirecionar(request, '/', response)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - /api/*      → route handlers authenticate themselves. Mobile calls them
     *                  with a Bearer token, not a cookie: a cookie-based redirect
     *                  to /login here would answer the app with an HTML page.
     *  - _next/*, and any file with an extension (sw.js, icons, manifest…),
     *    which must stay reachable for the service worker and static assets.
     */
    '/((?!api|_next/static|_next/image|.*\\.[\\w]+$).*)',
  ],
}
