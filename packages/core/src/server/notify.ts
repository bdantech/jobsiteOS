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
  const result: NotifyResult = {
    notificacoes: 0,
    webPushEnviados: 0,
    expoPushEnviados: 0,
    inscricoesRemovidas: 0,
  }
  if (userIds.length === 0) return result

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
  result.notificacoes = userIds.length

  // 2. Best-effort push. A dead endpoint must never fail the caller's mutation.
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
