import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@jobsiteos/core'

/**
 * ⚠️ SERVICE ROLE. THIS CLIENT BYPASSES RLS COMPLETELY.
 *
 * NEVER import this module from a client component. The `server-only` import
 * above turns such an import into a build error rather than a leaked key, but
 * treat that as a backstop, not a licence.
 *
 * Legitimate uses (there are exactly four in this phase):
 *   1. Resolving the caller's granted modules — `perfil_modulos` is admin-only
 *      under RLS, so a non-admin cannot read even their own grants. See lib/auth.ts.
 *   2. Reading/writing usuarios.web_push_subscriptions, expo_push_tokens and
 *      prefs_notificacoes — those columns are not granted to `authenticated` at all.
 *   3. notify() — needs (2).
 *   4. Admin user management (create user, set perfil/ativo) via the Admin API,
 *      which has no RLS insert policy by design.
 *
 * For everything else use lib/supabase/server.ts, so RLS still applies. In
 * particular: never pass this client to criarEmpresa/atualizarEmpresa/criarNota
 * — they are SECURITY INVOKER and would silently run with every check disabled.
 *
 * Anything you do with this client must be preceded by your own authorization
 * check, because the database will no longer make one for you.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para o cliente admin.',
    )
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      // No session to persist or refresh: this client is a machine, not a user.
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
