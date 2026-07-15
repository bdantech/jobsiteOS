'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  marcarNotificacaoLidaSchema,
  registrarPushWebSchema,
  type Json,
  type RegistrarPushWebInput,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSessionContext } from '@/lib/auth'
import { notificar } from '@/lib/notificacoes.server'

/**
 * ⚠️ Every export of this module is a `'use server'` action, which means Next
 * publishes it as an RPC endpoint any authenticated browser can call with
 * arbitrary arguments. So each one re-derives the caller from the session and
 * scopes its writes to that user. Nothing here takes a `usuario_id` argument —
 * the only user any of these can act on is you.
 */

export type ActionResult = { ok: true } | { ok: false; erro: string }

/** Shape actually stored in usuarios.web_push_subscriptions. */
const inscricoesWebPushSchema = z.array(registrarPushWebSchema).catch([])

// ─── in-app ─────────────────────────────────────────────────────────────────

/**
 * `lida` is the only column `authenticated` may touch on notificacoes, and
 * `notificacoes_update_own` already limits it to your own rows. The explicit
 * .eq('usuario_id') is belt-and-braces: it keeps the action correct even if
 * that policy is ever relaxed.
 */
export async function marcarComoLida(notificacaoId: string): Promise<ActionResult> {
  const { usuario } = await requireSessionContext()

  const parsed = marcarNotificacaoLidaSchema.safeParse({ notificacao_id: notificacaoId })
  if (!parsed.success) return { ok: false, erro: 'Notificação inválida.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('notificacoes')
    .update({ lida: true })
    .eq('id', parsed.data.notificacao_id)
    .eq('usuario_id', usuario.id)

  if (error) return { ok: false, erro: 'Não foi possível marcar a notificação como lida.' }

  revalidatePath('/notificacoes')
  return { ok: true }
}

export async function marcarTodasComoLidas(): Promise<ActionResult> {
  const { usuario } = await requireSessionContext()

  const supabase = await createClient()
  const { error } = await supabase
    .from('notificacoes')
    .update({ lida: true })
    .eq('usuario_id', usuario.id)
    .eq('lida', false)

  if (error) return { ok: false, erro: 'Não foi possível marcar as notificações como lidas.' }

  revalidatePath('/notificacoes')
  return { ok: true }
}

// ─── web push ───────────────────────────────────────────────────────────────

/**
 * SERVICE ROLE IS MANDATORY HERE. `usuarios.web_push_subscriptions` is not
 * granted to `authenticated` on ANY row — not even your own (migration 0005) —
 * so the user-scoped client cannot read or write this column at all. We
 * therefore authorise by hand (requireSessionContext) and scope every query to
 * the caller's own id.
 *
 * Subscriptions accumulate per browser/device, so this appends. It replaces any
 * entry with the same endpoint rather than duplicating it: re-subscribing in a
 * browser that already had a subscription is the common case (the keys rotate),
 * and duplicates would mean N identical push notifications per event.
 */
export async function registrarPushWeb(input: RegistrarPushWebInput): Promise<ActionResult> {
  const { usuario } = await requireSessionContext()

  const parsed = registrarPushWebSchema.safeParse(input)
  if (!parsed.success) return { ok: false, erro: 'Inscrição de push inválida.' }

  const admin = createAdminClient()

  const { data, error: readError } = await admin
    .from('usuarios')
    .select('web_push_subscriptions')
    .eq('id', usuario.id)
    .single()

  if (readError || !data) return { ok: false, erro: 'Não foi possível carregar suas inscrições.' }

  const atuais = inscricoesWebPushSchema.parse(data.web_push_subscriptions)
  const novas = [...atuais.filter((s) => s.endpoint !== parsed.data.endpoint), parsed.data]

  const { error: writeError } = await admin
    .from('usuarios')
    .update({ web_push_subscriptions: novas as unknown as Json })
    .eq('id', usuario.id)

  if (writeError) return { ok: false, erro: 'Não foi possível ativar as notificações push.' }

  return { ok: true }
}

/**
 * Called when the user turns push off, and by /api/push/web on
 * `pushsubscriptionchange`. Idempotent: removing an endpoint that is already
 * gone succeeds, because the caller's browser subscription is gone either way.
 */
export async function removerPushWeb(endpoint: string): Promise<ActionResult> {
  const { usuario } = await requireSessionContext()

  const parsed = z.string().url().safeParse(endpoint)
  if (!parsed.success) return { ok: false, erro: 'Endpoint inválido.' }

  const admin = createAdminClient()

  const { data, error: readError } = await admin
    .from('usuarios')
    .select('web_push_subscriptions')
    .eq('id', usuario.id)
    .single()

  if (readError || !data) return { ok: false, erro: 'Não foi possível carregar suas inscrições.' }

  const atuais = inscricoesWebPushSchema.parse(data.web_push_subscriptions)
  const novas = atuais.filter((s) => s.endpoint !== parsed.data)

  const { error: writeError } = await admin
    .from('usuarios')
    .update({ web_push_subscriptions: novas as unknown as Json })
    .eq('id', usuario.id)

  if (writeError) return { ok: false, erro: 'Não foi possível desativar as notificações push.' }

  return { ok: true }
}

// ─── notify() end to end ────────────────────────────────────────────────────

export type TesteResult =
  | { ok: true; webPushEnviados: number }
  | { ok: false; erro: string }

/**
 * Exercises the full notification path — notificar() → notify() → notificacoes
 * row + VAPID fan-out — and is the honest way for a user to verify that push
 * actually reaches this browser, which is otherwise unknowable until the first
 * real event fires at 3am.
 *
 * The recipient is hard-coded to the caller. This is a `'use server'` export, so
 * a `userIds` parameter here would be an open relay for spoofed company-wide
 * push notifications.
 */
export async function enviarNotificacaoDeTeste(): Promise<TesteResult> {
  const { usuario } = await requireSessionContext()

  try {
    const resultado = await notificar([usuario.id], {
      titulo: 'Notificação de teste',
      corpo: `Tudo certo, ${usuario.nome.split(' ')[0]}. As notificações do JobsiteOS estão funcionando.`,
      url: '/notificacoes',
    })

    return { ok: true, webPushEnviados: resultado.webPushEnviados }
  } catch {
    return { ok: false, erro: 'Não foi possível enviar a notificação de teste.' }
  }
}
