import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { MODULE_IDS, type Database, type Supabase } from '@jobsiteos/core'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * Identity for /api/ai. Same shape whether the caller arrived with a cookie
 * (web) or a bearer token (Expo has no cookies), so the route handler never
 * branches on transport again.
 */
export interface AiSession {
  userId: string
  nome: string
  /** Perfil name, for the system prompt. "Sem perfil" when the user has none. */
  perfil: string
  grantedModuleIds: string[]
  /**
   * USER-SCOPED client. Everything a tool does runs through this, so RLS decides
   * what the model can see and change — the model cannot reach data the user
   * could not reach by hand. Never swap this for the admin client.
   */
  supabase: Supabase
}

/**
 * Builds a user-scoped client that authenticates with the caller's access token
 * instead of a cookie. The token rides on every PostgREST request, so RLS sees
 * the real user exactly as it does on the cookie path.
 */
function createBearerClient(accessToken: string): Supabase {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  )
}

/**
 * Loads the caller's usuario row, perfil name and granted module ids.
 *
 * Uses the admin client for the same reason lib/auth.ts does: `perfis` and
 * `perfil_modulos` are gated by app_is_admin(), so a non-admin reading their own
 * grants with the user-scoped client gets zero rows — a silently permission-less
 * session, which for the AI Bar would mean a silently tool-less one. Identity is
 * established *first* by the token/cookie check; the escalation below is scoped
 * to that verified user id and nothing else.
 */
async function loadGrants(
  userId: string,
): Promise<{ nome: string; perfil: string; grantedModuleIds: string[] } | null> {
  const admin = createAdminClient()

  const { data: usuario, error } = await admin
    .from('usuarios')
    .select('id, nome, perfil_id, ativo')
    .eq('id', userId)
    .maybeSingle()

  // Deactivated users keep a valid JWT until it expires — refuse them here, so
  // deactivation takes effect on the next request rather than whenever the
  // token happens to lapse.
  if (error || !usuario || !usuario.ativo) return null

  if (!usuario.perfil_id) {
    return { nome: usuario.nome, perfil: 'Sem perfil', grantedModuleIds: [] }
  }

  const [{ data: perfil }, { data: modulos, error: modulosError }] = await Promise.all([
    admin.from('perfis').select('nome').eq('id', usuario.perfil_id).maybeSingle(),
    admin.from('perfil_modulos').select('modulo_id').eq('perfil_id', usuario.perfil_id),
  ])

  if (modulosError) return null

  // Intersect with the registry: a modulo_id left behind by a removed module
  // must not grant its tools to the model.
  const grantedModuleIds = (modulos ?? [])
    .map((m) => m.modulo_id)
    .filter((id) => MODULE_IDS.includes(id))

  return {
    nome: usuario.nome,
    perfil: perfil?.nome ?? 'Sem perfil',
    grantedModuleIds,
  }
}

/**
 * Authenticates the caller of /api/ai from EITHER a Supabase cookie session
 * (web) or an `Authorization: Bearer <access_token>` header (mobile).
 *
 * Returns null for anonymous, invalid-token and deactivated callers alike — all
 * three are a 401 to the route handler.
 */
export async function resolveAiSession(request: Request): Promise<AiSession | null> {
  const authorization = request.headers.get('authorization')
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()

  // The cast is a dependency-skew workaround, not a type escape hatch: the
  // installed @supabase/ssr@0.5.2 declares createServerClient as returning
  // SupabaseClient<Database, SchemaName, Schema>, which no longer matches the
  // generic list of @supabase/supabase-js@2.110 (the "^2.47.10" range floated).
  // The runtime object is the same user-scoped client either way. Remove the
  // cast once the supabase-js/ssr versions are aligned — see the note in the
  // handoff; every file that hands the cookie client to @jobsiteos/core hits it.
  const supabase: Supabase = bearer
    ? createBearerClient(bearer)
    : ((await createClient()) as unknown as Supabase)

  // getUser() revalidates the JWT against the auth server on both paths — it is
  // the only Supabase call that does. Passing the token explicitly on the bearer
  // path avoids depending on the client picking it up from the header.
  const {
    data: { user },
    error,
  } = bearer ? await supabase.auth.getUser(bearer) : await supabase.auth.getUser()

  if (error || !user) return null

  const grants = await loadGrants(user.id)
  if (!grants) return null

  return {
    userId: user.id,
    nome: grants.nome,
    perfil: grants.perfil,
    grantedModuleIds: grants.grantedModuleIds,
    supabase,
  }
}
