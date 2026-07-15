import 'server-only'

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@jobsiteos/core'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Authentication for route handlers — i.e. for the MOBILE app.
 *
 * The web app never comes through here: it mutates with server actions, which
 * already carry the session cookie and Next's own CSRF protection. Route
 * handlers exist because Expo has no cookie jar, so the mobile client sends
 * `Authorization: Bearer <access_token>` instead.
 *
 * BEARER ONLY, ON PURPOSE. Accepting the session cookie here as a fallback would
 * turn every one of these mutating endpoints into a CSRF target (a cross-site
 * form POST rides the user's cookies; a bearer header cannot be forged that
 * way). A caller that has cookies but no bearer token is a browser, and a
 * browser should be using a server action. So: no cookie fallback.
 *
 * The middleware deliberately does NOT match /api (see its matcher), so these
 * routes are unauthenticated until this function says otherwise.
 */

export interface ApiSessionUsuario {
  id: string
  nome: string
  email: string
  ativo: boolean
  must_change_password: boolean
}

export interface ApiSession {
  usuario: ApiSessionUsuario
  /** ⚠️ SERVICE ROLE — bypasses RLS. Only ever act on `usuario.id` with it. */
  admin: SupabaseClient<Database>
  accessToken: string
}

export type ApiAuth = { ok: true; session: ApiSession } | { ok: false; response: NextResponse }

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!header) return null

  const [scheme, ...rest] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return null

  const token = rest.join(' ').trim()
  return token.length > 0 ? token : null
}

/**
 * A client that carries the caller's JWT, so anything done with it runs under
 * RLS as that user. Exported because a route that reads or writes ordinary
 * tables should use THIS, not the admin client.
 */
export function createBearerClient(accessToken: string): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY são obrigatórios.')
  }

  return createSupabaseClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

/**
 * Resolves the caller from the Bearer token, or produces the response to return.
 *
 * `getUser(jwt)` is a round trip to the auth server, which is the point: it
 * revalidates the token rather than trusting its signature-free decode, so a
 * token revoked by a sign-out is rejected here.
 *
 * A deactivated user keeps a technically valid JWT until it expires — same rule
 * as the web middleware, they are treated as signed out.
 */
export async function requireApiSession(request: Request): Promise<ApiAuth> {
  const accessToken = bearerToken(request)
  if (!accessToken) {
    return { ok: false, response: jsonError('Autenticação obrigatória.', 401) }
  }

  const scoped = createBearerClient(accessToken)
  const {
    data: { user },
    error,
  } = await scoped.auth.getUser(accessToken)

  if (error || !user) {
    return { ok: false, response: jsonError('Sessão inválida ou expirada.', 401) }
  }

  const admin = createAdminClient()

  // The usuarios row is read with the service role because some of what callers
  // need (prefs_notificacoes, expo_push_tokens) is not granted to
  // `authenticated` on ANY row. Pinned to the id from the token we just
  // revalidated — no client input reaches this lookup.
  const { data: usuario, error: usuarioError } = await admin
    .from('usuarios')
    .select('id, nome, email, ativo, must_change_password')
    .eq('id', user.id)
    .maybeSingle()

  if (usuarioError) {
    return { ok: false, response: jsonError('Falha ao carregar sua conta.', 500) }
  }
  if (!usuario) {
    return { ok: false, response: jsonError('Sessão inválida ou expirada.', 401) }
  }
  if (!usuario.ativo) {
    return { ok: false, response: jsonError('Sua conta foi desativada.', 403) }
  }

  return { ok: true, session: { usuario, admin, accessToken } }
}

/** Body parsing that answers with a 400 instead of throwing on malformed JSON. */
export async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    const text = await request.text()
    if (!text) return { ok: true, body: {} }
    return { ok: true, body: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, response: jsonError('Corpo da requisição inválido.', 400) }
  }
}
