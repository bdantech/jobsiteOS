import {
  prefsNotificacoesSchema,
  type AlterarSenhaInput,
  type PrefsNotificacoes,
  type RegistrarPushExpoInput,
} from '@jobsiteos/core'

import { api, ApiError } from '@/lib/api'

/**
 * Everything on this screen that supabase-js on the phone is structurally unable
 * to do, and therefore goes through the Next.js backend:
 *
 *  - must_change_password  → no update grant for `authenticated`
 *  - prefs_notificacoes    → column not granted to `authenticated`, on any row
 *  - expo_push_tokens      → same
 *
 * There is no service-role client on mobile, and there must never be one: the key
 * would ship inside the bundle.
 */

/**
 * Changes the password AND clears must_change_password, in one call.
 *
 * Deliberately not two steps. A separate "clear my flag" endpoint would let
 * anyone holding the emailed temporary password skip the rotation and keep that
 * password indefinitely — so the backend performs the rotation itself and treats
 * the flag as a consequence of it, never as an input. See the route handler.
 */
export async function alterarSenha(input: AlterarSenhaInput): Promise<void> {
  await api<{ ok: true }>('/api/auth/alterar-senha', { method: 'POST', body: input })
}

export async function buscarPreferencias(): Promise<PrefsNotificacoes> {
  const { prefs } = await api<{ prefs: unknown }>('/api/me/preferencias')
  // The server already normalises this, but parsing again means a malformed
  // payload can never light up a switch that isn't really on.
  return prefsNotificacoesSchema.parse(prefs ?? {})
}

export async function salvarPreferencias(
  patch: Partial<PrefsNotificacoes>,
): Promise<PrefsNotificacoes> {
  const { prefs } = await api<{ prefs: unknown }>('/api/me/preferencias', {
    method: 'PATCH',
    body: patch,
  })
  return prefsNotificacoesSchema.parse(prefs ?? {})
}

/** Owned by the notifications feature (/api/push/expo). Idempotent per token. */
export async function registrarDispositivo(input: RegistrarPushExpoInput): Promise<void> {
  await api<{ ok: true }>('/api/push/expo', { method: 'POST', body: input })
}

export async function removerDispositivo(token: string): Promise<void> {
  await api<{ ok: true }>('/api/push/expo', { method: 'DELETE', body: { token } })
}

// ─── error shaping ──────────────────────────────────────────────────────────

/**
 * Pulls the pt-BR message out of an ApiError.
 *
 * Two error envelopes exist in the backend — `{ error }` (the routes in this
 * feature) and `{ erro }` (the push route, owned by another feature) — so read
 * both rather than showing "Falha na requisição (400)" to a user.
 */
export function mensagemDeErro(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback

  const body = error.body
  if (typeof body === 'object' && body !== null) {
    const erro = (body as { erro?: unknown }).erro
    if (typeof erro === 'string' && erro.length > 0) return erro
  }

  return error.message || fallback
}

/** Field-level messages the server produced (zod `flatten().fieldErrors`). */
export function erroDoCampo(error: unknown, campo: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined

  const body = error.body
  if (typeof body !== 'object' || body === null) return undefined

  const fieldErrors = (body as { fieldErrors?: unknown }).fieldErrors
  if (typeof fieldErrors !== 'object' || fieldErrors === null) return undefined

  const lista = (fieldErrors as Record<string, unknown>)[campo]
  if (!Array.isArray(lista)) return undefined

  const primeiro: unknown = lista[0]
  return typeof primeiro === 'string' ? primeiro : undefined
}
