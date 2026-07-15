import { useQueryClient } from '@tanstack/react-query'
import * as Notifications from 'expo-notifications'
import { usePathname, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'

import { useSession } from '@/lib/auth'
import { resolveNotificationHref } from '@/lib/linking'

import { notificacoesKeys, useNotificacoesRealtime } from './queries'
import { ensurePushRegistration, resetPushRegistration } from './push'

/**
 * Foreground presentation. Without a handler, a push that arrives while the app
 * is open is delivered silently to JS and never shown — which reads as "push is
 * broken" to the user. Set once, at module scope: it is global to the process,
 * not per component.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

/**
 * Taps we have already navigated for, keyed by the notification's request id.
 *
 * `useLastNotificationResponse()` keeps returning the same response object (it is
 * how a cold start from a notification is delivered at all), and the hook may be
 * mounted by more than one component. Without this, a single tap could navigate
 * twice — or navigate again on every remount.
 */
const handledResponses = new Set<string>()

function notificationUrl(response: Notifications.NotificationResponse): string | null {
  // notify() puts the deep link in data.url (server/notify.ts). Typed as
  // Record<string, any> upstream, so narrow it before trusting it.
  const data = response.notification.request.content.data as Record<string, unknown> | undefined
  const url = data?.url

  return typeof url === 'string' ? url : null
}

/**
 * Everything the notifications feature needs running while the user is signed in:
 *
 *   1. Expo push registration (once per user, per app run)
 *   2. the Realtime subscription behind the bell's unread badge
 *   3. a foreground listener, so an arriving push refreshes the list/badge
 *   4. tap handling — including the tap that COLD-STARTS the app
 *
 * Mounted by <NotificationsBell/>, which the shell renders on every screen. It is
 * idempotent and safe to mount more than once (see <NotificacoesRuntime/>), so
 * the root layout may also mount it without double-registering or double-navigating.
 */
export function useNotificacoesRuntime(): void {
  const { user, usuario, grantedModuleIds, loading } = useSession()
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()

  useNotificacoesRealtime()

  const userId = user?.id ?? null
  const mustChangePassword = usuario?.must_change_password === true

  // 1. Registration. Deliberately NOT while the forced-password-change wall is
  //    up: the OS permission dialog would land on top of it, and a user who has
  //    not finished onboarding is the worst possible moment to ask.
  useEffect(() => {
    if (loading || !userId || mustChangePassword) return
    void ensurePushRegistration(userId)
  }, [loading, userId, mustChangePassword])

  // Sign-out: let the next sign-in register again (possibly as a different user
  // on the same device).
  const previousUserId = useRef<string | null>(null)
  useEffect(() => {
    if (previousUserId.current && !userId) resetPushRegistration()
    previousUserId.current = userId
  }, [userId])

  // 3. A push received while the app is in the foreground is NOT an INSERT the
  //    Realtime channel will re-deliver reliably (the row was written before the
  //    push was sent, and the socket may be reconnecting). Refresh on both paths;
  //    react-query dedupes the overlap.
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: notificacoesKeys.all })
    })

    return () => subscription.remove()
  }, [queryClient])

  // 4. Taps. useLastNotificationResponse() covers both the warm case (app in the
  //    background) and the cold one (app launched BY the tap) — the plain
  //    response listener misses the latter, because it is attached after the
  //    event was emitted.
  const response = Notifications.useLastNotificationResponse()

  useEffect(() => {
    if (!response || loading || !userId) return

    // Do not navigate out from under the root gate: on /login it is about to
    // replace() to the landing route, and /alterar-senha is a wall. The effect
    // re-runs when the pathname settles, and the response is still pending.
    if (mustChangePassword || pathname === '/login' || pathname === '/alterar-senha') return

    const responseId = response.notification.request.identifier
    if (handledResponses.has(responseId)) return
    handledResponses.add(responseId)

    // Stops the same response from being replayed on a later remount.
    void Notifications.clearLastNotificationResponseAsync()

    // The payload is attacker-influenced in the general case, so the url is
    // validated against the registry: an ungranted or webOnly (admin) route
    // falls back to the user's landing route rather than a dead screen.
    const href = resolveNotificationHref(notificationUrl(response), grantedModuleIds)

    void queryClient.invalidateQueries({ queryKey: notificacoesKeys.all })
    router.push(href)
  }, [
    response,
    loading,
    userId,
    mustChangePassword,
    pathname,
    grantedModuleIds,
    router,
    queryClient,
  ])
}

/**
 * Mountable form of the hook, for the root layout. Renders nothing.
 * Mounting this AND rendering <NotificationsBell/> is fine — see the hook.
 */
export function NotificacoesRuntime(): null {
  useNotificacoesRuntime()
  return null
}
