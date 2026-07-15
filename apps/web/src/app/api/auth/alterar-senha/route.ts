import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { alterarSenhaSchema, type Database } from '@jobsiteos/core'

import { jsonError, readJsonBody, requireApiSession } from '../../_lib/session'

/**
 * Password change for the mobile app (the web app does this in a server action).
 *
 * It is ONE endpoint, not two, and that is the whole security design.
 *
 * The obvious decomposition — mobile calls supabase.auth.updateUser() itself,
 * then asks the backend to clear must_change_password — needs a bare
 * "clear my flag" endpoint. That endpoint is a hole: `must_change_password`
 * exists to force rotation of a temporary password that was EMAILED (a
 * low-trust channel), and anyone holding that temp password could simply call
 * the endpoint, skip the rotation, and keep the emailed password alive forever.
 * The flag would then assert something false.
 *
 * So the flag is never an input. It is a CONSEQUENCE of a rotation this route
 * performed and verified:
 *
 *   1. The Bearer token proves who is calling.
 *   2. alterarSenhaSchema is re-validated HERE. Client-side zod is UX; this is
 *      the enforcement.
 *   3. The new password is proven to differ from the current one (below).
 *   4. Only then is the password changed, and only then is the flag cleared.
 */

export const runtime = 'nodejs'

/**
 * Is `senha` already this user's password?
 *
 * GoTrue *can* be configured to reject a password identical to the current one,
 * but that is a project setting we do not control from code — and if it is off,
 * a user "rotating" a temporary password to the exact same string would sail
 * through, which defeats the entire forced-change flow. So we check it
 * ourselves, deterministically, by trying to sign in with it.
 *
 * The attempt mints a throwaway session, which we immediately revoke with
 * scope 'local' — that revokes ONLY this ephemeral session's refresh token, and
 * specifically not the caller's real session on their phone (scope 'global'
 * would have signed them out of everything).
 *
 * Fails open: if the sign-in call errors for some unrelated reason (rate limit,
 * network), we report "not the same" and let the change proceed. That is the
 * safe direction — the worst case is a user re-setting the same strong password
 * they already had, whereas failing closed would lock a legitimate user out of
 * the change-password screen entirely.
 */
async function senhaEhAAtual(email: string, senha: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return false

  const efemero = createSupabaseClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const { data, error } = await efemero.auth.signInWithPassword({ email, password: senha })
  if (error || !data.session) return false

  try {
    await efemero.auth.signOut({ scope: 'local' })
  } catch {
    // The throwaway refresh token lives only in this process's memory and is
    // discarded with the client. Not worth failing the request over.
  }

  return true
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireApiSession(request)
  if (!auth.ok) return auth.response

  const { usuario, admin } = auth.session

  const parsedBody = await readJsonBody(request)
  if (!parsedBody.ok) return parsedBody.response

  const parsed = alterarSenhaSchema.safeParse(parsedBody.body)
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors
    return NextResponse.json(
      { error: 'Senha inválida.', fieldErrors },
      { status: 422 },
    )
  }

  const { senha } = parsed.data

  if (await senhaEhAAtual(usuario.email, senha)) {
    return NextResponse.json(
      { error: 'A nova senha deve ser diferente da atual.', fieldErrors: { senha: ['A nova senha deve ser diferente da atual.'] } },
      { status: 422 },
    )
  }

  // The Admin API, not a user-scoped updateUser(): supabase-js's updateUser()
  // needs a *persisted session* on the client, and all we were given is an
  // access token (no refresh token) — reconstructing a session from it is
  // fragile. Authorisation for this escalation was established above, and it is
  // pinned to usuario.id, which came from the revalidated token.
  const { error: senhaError } = await admin.auth.admin.updateUserById(usuario.id, {
    password: senha,
  })

  if (senhaError) {
    return jsonError('Não foi possível alterar a senha. Tente novamente.', 500)
  }

  // The password is already rotated at this point, so the flag MUST come down —
  // otherwise the user is walled out of an app whose password they just
  // changed. Retry a few times before giving up.
  let flagError: string | null = null
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const { error } = await admin
      .from('usuarios')
      .update({ must_change_password: false })
      .eq('id', usuario.id)

    if (!error) {
      return NextResponse.json({ ok: true })
    }
    flagError = error.message
    await new Promise((resolve) => setTimeout(resolve, 150 * (tentativa + 1)))
  }

  // Rotation succeeded but the flag is stuck true: the user is now holding a
  // password that works, behind a wall that won't lift. Say so precisely — the
  // one thing we must not do is pretend it worked.
  console.error('[alterar-senha] senha alterada mas must_change_password persistiu:', flagError)
  return jsonError(
    'Sua senha foi alterada, mas não conseguimos liberar seu acesso. Entre novamente com a nova senha — se o problema continuar, fale com um administrador.',
    500,
  )
}
