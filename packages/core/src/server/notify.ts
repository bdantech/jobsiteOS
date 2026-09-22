import { Expo, type ExpoPushMessage } from 'expo-server-sdk'
import webpush from 'web-push'
import type { Supabase } from '../registry/types.js'
import { prefsNotificacoesSchema } from '../schemas/index.js'

/**
 * SERVER ONLY. Never import from a client component or from apps/mobile.
 *
 * The one notification path in the system: writes the `notificacoes` rows (which
 * the bell reads over Realtime) and fans out to whichever push channels each
 * user has actually registered. Callers don't care which platforms a user is on.
 *
 * Requires a SERVICE-ROLE client: `web_push_subscriptions` and `expo_push_tokens`
 * are not granted to `authenticated` on any row (migration 0005), precisely so
 * that no browser session can enumerate a colleague's push endpoints.
 */

export interface NotifyPayload {
  titulo: string
  corpo?: string
  /** Deep link. Web uses it as a route; mobile resolves it via the linking config. */
  url?: string
}

export interface NotifyResult {
  notificacoes: number
  webPushEnviados: number
  expoPushEnviados: number
  inscricoesRemovidas: number
}

interface WebPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

let vapidConfigured = false

function configureVapid(): boolean {
  if (vapidConfigured) return true

  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return false

  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
  return true
}

export async function notify(
  supabaseAdmin: Supabase,
  userIds: readonly string[],
  payload: NotifyPayload,
): Promise<NotifyResult> {
  if (userIds.length === 0) return vazio()

  // 1. The durable part. The bell must show it even if every push channel fails.
  const { error: insertError } = await supabaseAdmin.from('notificacoes').insert(
    userIds.map((usuario_id) => ({
      usuario_id,
      titulo: payload.titulo,
      corpo: payload.corpo ?? null,
      url: payload.url ?? null,
    })),
  )
  if (insertError) throw new Error(`Falha ao gravar notificações: ${insertError.message}`)

  // 2. Best-effort push. A dead endpoint must never fail the caller's mutation.
  const push = await enviarPush(supabaseAdmin, userIds, payload)
  return { ...push, notificacoes: userIds.length }
}

function vazio(): NotifyResult {
  return { notificacoes: 0, webPushEnviados: 0, expoPushEnviados: 0, inscricoesRemovidas: 0 }
}

/**
 * The push half of `notify()`, on its own — no `notificacoes` row is written.
 *
 * It exists for one case, and only one: the bell already came from somewhere else. The
 * `fanout_evento_para_notificacoes` trigger writes bell rows for every recipient a
 * `notificacao_regras` row names, on every path that emits the event — including the
 * ones that never touch Node (a mobile client calling the RPC directly, the AI bar).
 * That is the durable half, and it is already complete.
 *
 * What the trigger cannot do is push: Postgres has no VAPID keys and no Expo client. So
 * the server paths call this afterwards to add the push for the same people, and calling
 * `notify()` there would ring the bell a second time for the same fact.
 *
 * Same contract as the push half of `notify()`: never throws, honours each user's
 * `prefs_notificacoes`, and garbage-collects revoked browser subscriptions.
 */
export async function enviarPush(
  supabaseAdmin: Supabase,
  userIds: readonly string[],
  payload: NotifyPayload,
): Promise<NotifyResult> {
  const result = vazio()
  if (userIds.length === 0) return result

  const { data: usuarios } = await supabaseAdmin
    .from('usuarios')
    .select('id, web_push_subscriptions, expo_push_tokens, prefs_notificacoes')
    .in('id', userIds as string[])
    .eq('ativo', true)

  if (!usuarios?.length) return result

  const expo = new Expo()
  const expoMessages: ExpoPushMessage[] = []
  const webPushJobs: Promise<void>[] = []
  const deadEndpoints: { userId: string; endpoint: string }[] = []

  for (const usuario of usuarios) {
    const prefs = prefsNotificacoesSchema.safeParse(usuario.prefs_notificacoes)
    const wantsWeb = prefs.success ? prefs.data.push_web : true
    const wantsMobile = prefs.success ? prefs.data.push_mobile : true

    if (wantsWeb && configureVapid()) {
      const subs = (usuario.web_push_subscriptions ?? []) as unknown as WebPushSubscription[]
      for (const sub of subs) {
        webPushJobs.push(
          webpush
            .sendNotification(sub, JSON.stringify(payload))
            .then(() => {
              result.webPushEnviados++
            })
            .catch((err: { statusCode?: number }) => {
              // 404/410 = the browser revoked this subscription. Anything else is
              // transient (network, push service hiccup) and we keep the sub.
              if (err.statusCode === 404 || err.statusCode === 410) {
                deadEndpoints.push({ userId: usuario.id, endpoint: sub.endpoint })
              }
            }),
        )
      }
    }

    if (wantsMobile) {
      const tokens = (usuario.expo_push_tokens ?? []) as unknown as { token: string }[]
      for (const { token } of tokens) {
        if (!Expo.isExpoPushToken(token)) continue
        expoMessages.push({
          to: token,
          title: payload.titulo,
          body: payload.corpo ?? '',
          data: payload.url ? { url: payload.url } : {},
          sound: 'default',
        })
      }
    }
  }

  await Promise.all(webPushJobs)

  for (const chunk of expo.chunkPushNotifications(expoMessages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk)
      result.expoPushEnviados += tickets.filter((t) => t.status === 'ok').length
    } catch {
      // Expo is down or the chunk was rejected wholesale. The notificacoes rows
      // are already committed, so the user still sees this in the bell.
    }
  }

  // 3. Garbage-collect revoked browser subscriptions, so they aren't retried forever.
  for (const { userId, endpoint } of deadEndpoints) {
    const usuario = usuarios.find((u) => u.id === userId)
    if (!usuario) continue
    const subs = (usuario.web_push_subscriptions ?? []) as unknown as WebPushSubscription[]
    const restantes = subs.filter((s) => s.endpoint !== endpoint)
    await supabaseAdmin
      .from('usuarios')
      .update({ web_push_subscriptions: restantes as never })
      .eq('id', userId)
    result.inscricoesRemovidas++
  }

  return result
}

/**
 * Notifies people named by a BUSINESS RULE — the person who asked for the analysis, the
 * owner of the card — without ringing the bell twice for anyone the event's fan-out
 * already reached.
 *
 * The two mechanisms answer different questions and both are right:
 *
 * - `notificacao_regras` + the fan-out trigger answer "which ROLES watch this kind of
 *   event" — a standing subscription, configured, the same for every row.
 * - This answers "which PERSON is this particular row about" — it comes from the data
 *   (`analises_credito.solicitada_por`), not from configuration, and no table of rules
 *   could express it.
 *
 * They overlap whenever the named person happens to hold a subscribed role: a Crédito
 * analyst who asks for an analysis of their own. There the bell already exists, so this
 * sends only the push. Two identical bell rows for one fact is how a bell teaches people
 * to stop reading it.
 *
 * `tipoEvento` is the event the caller just emitted — pass null when the caller wrote no
 * event at all, and every recipient gets the full treatment.
 */
export async function notificarNomeados(
  supabaseAdmin: Supabase,
  userIds: readonly string[],
  tipoEvento: string | null,
  payload: NotifyPayload,
): Promise<NotifyResult> {
  const destinatarios = [...new Set(userIds)].filter((id) => id.length > 0)
  if (destinatarios.length === 0) return vazio()
  if (!tipoEvento) return notify(supabaseAdmin, destinatarios, payload)

  const { data: regras } = await supabaseAdmin
    .from('notificacao_regras')
    .select('perfil_id, usuario_id')
    .eq('tipo_evento', tipoEvento)
    .eq('ativo', true)

  const perfisComRegra = new Set(
    (regras ?? []).map((r) => r.perfil_id).filter((id): id is string => !!id),
  )
  const usuariosComRegra = new Set(
    (regras ?? []).map((r) => r.usuario_id).filter((id): id is string => !!id),
  )

  const { data: usuarios } = await supabaseAdmin
    .from('usuarios')
    .select('id, perfil_id')
    .in('id', destinatarios)

  const jaTemSino = new Set(
    (usuarios ?? [])
      .filter((u) => usuariosComRegra.has(u.id) || (u.perfil_id && perfisComRegra.has(u.perfil_id)))
      .map((u) => u.id),
  )

  const soPush = destinatarios.filter((id) => jaTemSino.has(id))
  const completos = destinatarios.filter((id) => !jaTemSino.has(id))

  const [a, b] = await Promise.all([
    completos.length ? notify(supabaseAdmin, completos, payload) : Promise.resolve(vazio()),
    soPush.length ? enviarPush(supabaseAdmin, soPush, payload) : Promise.resolve(vazio()),
  ])

  return {
    notificacoes: a.notificacoes + b.notificacoes,
    webPushEnviados: a.webPushEnviados + b.webPushEnviados,
    expoPushEnviados: a.expoPushEnviados + b.expoPushEnviados,
    inscricoesRemovidas: a.inscricoesRemovidas + b.inscricoesRemovidas,
  }
}
