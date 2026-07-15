'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prefsNotificacoesSchema } from '@jobsiteos/core'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionContext } from '@/lib/auth'
import type { FormState } from '@/lib/form-state'

/**
 * `prefs_notificacoes` is not granted to `authenticated` on ANY row — not even
 * your own (migration 0005). So even saving your own preferences has to go
 * through the service role, which bypasses RLS entirely. The only thing standing
 * between a caller and someone else's row is the rule this action follows:
 *
 *   the row is pinned to context.user.id — the id from the JWT that
 *   getSessionContext() revalidated against the auth server — NEVER to an id
 *   taken from the form.
 *
 * Scope note: the sibling columns web_push_subscriptions / expo_push_tokens are
 * owned by src/actions/notificacoes.ts (registrarPushWeb / removerPushWeb). This
 * file deliberately does not touch them: two read-modify-write paths into the
 * same jsonb array would drop a subscription whenever they interleave.
 */
export async function salvarPrefsNotificacoes(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = await getSessionContext()
  if (!context) redirect('/login')

  const parsed = prefsNotificacoesSchema.safeParse({
    // An unchecked switch submits nothing at all, which is exactly `false`.
    push_web: formData.get('push_web') === 'on',
    push_mobile: formData.get('push_mobile') === 'on',
  })

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Preferências inválidas.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const admin = createAdminClient()

  const { error } = await admin
    .from('usuarios')
    .update({ prefs_notificacoes: parsed.data })
    .eq('id', context.user.id)

  if (error) {
    return { status: 'error', message: 'Não foi possível salvar suas preferências.' }
  }

  revalidatePath('/settings')
  return { status: 'success', message: 'Preferências salvas.' }
}
