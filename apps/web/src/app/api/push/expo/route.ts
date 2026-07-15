import { NextResponse } from 'next/server'
import { z } from 'zod'
import { registrarPushExpoSchema, type Json } from '@jobsiteos/core'

import { jsonError, readJsonBody, requireApiSession, type ApiSession } from '../../_lib/session'

/**
 * Expo push token registration — the mobile backend. apps/mobile has no cookies
 * and no server actions, so it authenticates with `Authorization: Bearer <token>`
 * like every other route under /api.
 *
 * AUTH IS NOT IMPLEMENTED HERE. It is `requireApiSession`, shared with
 * /api/auth/alterar-senha and /api/me/preferencias — one implementation of
 * "verify the bearer token, reject a deactivated user, and tell me who is
 * calling". These routes hold the SERVICE ROLE (usuarios.expo_push_tokens is not
 * granted to `authenticated` on any row, so a user-scoped client cannot see the
 * column at all), which makes the caller's identity the only thing standing
 * between them and a colleague's row. That check gets exactly one copy.
 *
 * Every write below is scoped to `usuario.id`, taken from the revalidated token.
 * No id is ever read from the request body. The single exception is
 * `revogarTokenDeOutrosUsuarios` — see the note on it.
 */

export const runtime = 'nodejs'

const tokenArmazenadoSchema = z.object({
  token: z.string().min(1),
  device: z.string().optional(),
  registrado_em: z.string().optional(),
})
type TokenArmazenado = z.infer<typeof tokenArmazenadoSchema>

const tokensArmazenadosSchema = z.array(tokenArmazenadoSchema).catch([])

const removerSchema = z.object({ token: z.string().min(1) })

/**
 * One person, a phone and a tablet, plus a few reinstalls (each mints a NEW
 * token, so the array would otherwise grow without bound and notify() would fan
 * out to long-dead installs on every send).
 */
const MAX_DISPOSITIVOS = 10

/** ⚠️ SERVICE ROLE — bypasses RLS. Only ever act on the caller's id with it. */
type Admin = ApiSession['admin']

async function lerTokens(admin: Admin, usuarioId: string): Promise<TokenArmazenado[] | null> {
  const { data, error } = await admin
    .from('usuarios')
    .select('expo_push_tokens')
    .eq('id', usuarioId)
    .maybeSingle()

  if (error || !data) return null
  return tokensArmazenadosSchema.parse(data.expo_push_tokens)
}

async function gravarTokens(
  admin: Admin,
  usuarioId: string,
  tokens: TokenArmazenado[],
): Promise<boolean> {
  const { error } = await admin
    .from('usuarios')
    .update({ expo_push_tokens: tokens as unknown as Json })
    .eq('id', usuarioId)

  return !error
}

/**
 * ⚠️ THE ONLY WRITE IN THE /api SURFACE THAT TOUCHES A ROW OTHER THAN THE
 * CALLER'S. Read this before changing it.
 *
 * A device changes hands: Ana signs out of the company tablet, Bruno signs in.
 * Expo re-issues the SAME token to that install, so if Ana's row kept it, every
 * notification meant for Ana — titles and bodies about real companies — would be
 * pushed to a device Bruno is now holding. RLS cannot catch this: the fan-out
 * (notify()) runs server-side on the service role. Sign-out's DELETE cannot be
 * relied on either; the app may be killed, reinstalled, or offline.
 *
 * So registration is the moment of truth, and the rule is the standard one for
 * every push backend (APNs/FCM/Expo alike): a device token identifies an INSTALL,
 * not an account, and the last account to register it owns it. Everyone else
 * loses it.
 *
 * Why this cannot be used to escalate:
 *   - It only ever REMOVES, never adds, and only ever the one exact token string
 *     in the request body. No other column, no other value.
 *   - Removing a token cannot make you *receive* anyone's notifications — it can
 *     only stop them arriving on hardware that is no longer theirs.
 *   - The tokens are high-entropy values the server never discloses
 *     (expo_push_tokens is readable by nobody but the service role), so to aim
 *     this at a colleague you must already hold their device's token — i.e.
 *     already hold their device, which is the exact case this exists to handle.
 *
 * Best-effort: the caller's own registration has already succeeded and must not
 * be failed by this.
 */
async function revogarTokenDeOutrosUsuarios(
  admin: Admin,
  token: string,
  usuarioId: string,
): Promise<void> {
  // jsonb containment (@>): rows whose array holds an object with this token.
  const { data: outros, error } = await admin
    .from('usuarios')
    .select('id, expo_push_tokens')
    .neq('id', usuarioId)
    .contains('expo_push_tokens', [{ token }])

  if (error || !outros?.length) return

  await Promise.all(
    outros.map(async (outro) => {
      const restantes = tokensArmazenadosSchema
        .parse(outro.expo_push_tokens)
        .filter((t) => t.token !== token)

      await admin
        .from('usuarios')
        .update({ expo_push_tokens: restantes as unknown as Json })
        .eq('id', outro.id)
    }),
  )
}

/** Register (or refresh) this device's Expo push token. Called on login. */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireApiSession(request)
  if (!auth.ok) return auth.response

  const { usuario, admin } = auth.session

  const parsedBody = await readJsonBody(request)
  if (!parsedBody.ok) return parsedBody.response

  const parsed = registrarPushExpoSchema.safeParse(parsedBody.body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Token de push inválido.', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    )
  }

  const atuais = await lerTokens(admin, usuario.id)
  if (atuais === null) return jsonError('Não foi possível carregar os tokens.', 500)

  // Dedupe on the token itself, not the device name: reinstalling the app yields
  // a new token on the same device, and two entries would mean two pushes.
  const novos: TokenArmazenado[] = [
    ...atuais.filter((t) => t.token !== parsed.data.token),
    {
      token: parsed.data.token,
      device: parsed.data.device,
      registrado_em: new Date().toISOString(),
    },
  ].slice(-MAX_DISPOSITIVOS) // newest win; abandoned installs age out

  if (!(await gravarTokens(admin, usuario.id, novos))) {
    return jsonError('Não foi possível salvar o token.', 500)
  }

  await revogarTokenDeOutrosUsuarios(admin, parsed.data.token, usuario.id)

  return NextResponse.json({ ok: true })
}

/** Unregister this device. Called on logout, so a shared phone stops receiving. */
export async function DELETE(request: Request): Promise<NextResponse> {
  const auth = await requireApiSession(request)
  if (!auth.ok) return auth.response

  const { usuario, admin } = auth.session

  const parsedBody = await readJsonBody(request)
  if (!parsedBody.ok) return parsedBody.response

  const parsed = removerSchema.safeParse(parsedBody.body)
  if (!parsed.success) return jsonError('Token inválido.', 422)

  const atuais = await lerTokens(admin, usuario.id)
  if (atuais === null) return jsonError('Não foi possível carregar os tokens.', 500)

  const novos = atuais.filter((t) => t.token !== parsed.data.token)

  if (!(await gravarTokens(admin, usuario.id, novos))) {
    return jsonError('Não foi possível remover o token.', 500)
  }

  return NextResponse.json({ ok: true })
}
