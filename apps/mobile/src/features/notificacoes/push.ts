import { BRAND_ACCENT, registrarPushExpoSchema } from '@jobsiteos/core'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { api } from '@/lib/api'

/**
 * Expo push registration.
 *
 * WHY THIS GOES THROUGH THE BACKEND: the token belongs in
 * `usuarios.expo_push_tokens`, and that column is not granted to `authenticated`
 * on ANY row — not even your own (migration 0005). A PostgREST update from this
 * app would not error; it would silently update zero columns, and push would
 * appear to work forever while never arriving. So the token is POSTed to
 * /api/push/expo, which verifies the bearer token and writes the caller's row
 * with the service-role client.
 */

/** Must match `defaultChannel` in app.json's expo-notifications plugin config. */
export const ANDROID_CHANNEL_ID = 'default'

export type PushRegistrationStatus =
  /** Token minted and stored against this user. */
  | 'registrado'
  /** Simulator/emulator: Apple and Google issue device tokens to hardware only. */
  | 'simulador'
  /** The user said no (or never answered). Not an error — do not nag. */
  | 'sem-permissao'
  /** EAS_PROJECT_ID was never set, so Expo cannot attribute a token. */
  | 'sem-projeto'
  /** Network, Expo push service, or our backend rejected it. */
  | 'falha'

export interface PushRegistrationResult {
  status: PushRegistrationStatus
  token?: string
}

/**
 * Android needs the channel to exist BEFORE the first notification arrives, or
 * the system files it under a default channel the user cannot configure.
 * Idempotent — creating an existing channel just updates it.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Notificações',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: BRAND_ACCENT,
    vibrationPattern: [0, 250, 250, 250],
  })
}

/**
 * `extra.eas.projectId`, injected by app.config.ts from EAS_PROJECT_ID. Absent
 * until the operator runs `eas init` — getExpoPushTokenAsync() would throw, so
 * we detect it and degrade to a status instead of crashing the shell.
 */
function resolveProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined
  const projectId = extra?.eas?.projectId

  return typeof projectId === 'string' && projectId.length > 0 ? projectId : null
}

/** Human label so a user can tell their devices apart. Schema caps it at 120. */
function deviceLabel(): string {
  const name = Device.deviceName ?? Device.modelName ?? Platform.OS
  return name.slice(0, 120)
}

async function hasPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync()
  if (current.granted) return true

  // Asking again once already-denied is a no-op on both platforms (the OS
  // returns the standing answer without showing a dialog), so this is safe.
  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  })

  return requested.granted
}

/**
 * Full registration: permission → Expo token → our backend.
 *
 * Never throws: every failure mode is a status the caller can log or surface.
 * Push is an enhancement — the `notificacoes` rows (and therefore the bell) land
 * regardless of whether any of this succeeds.
 */
export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  // Simulators/emulators cannot obtain an APNs/FCM token. Bail before prompting
  // for a permission that could never deliver anything.
  if (!Device.isDevice) return { status: 'simulador' }

  await ensureAndroidChannel()

  if (!(await hasPermission())) return { status: 'sem-permissao' }

  const projectId = resolveProjectId()
  if (!projectId) return { status: 'sem-projeto' }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })

    // Same schema the route validates with, so a malformed token is caught here
    // rather than as a 400 round trip.
    const body = registrarPushExpoSchema.parse({ token, device: deviceLabel() })
    await api<{ ok: true }>('/api/push/expo', { method: 'POST', body })

    return { status: 'registrado', token }
  } catch {
    // Offline, Expo's token service down, or the backend refused. The next
    // foreground with a fresh session retries.
    return { status: 'falha' }
  }
}

/**
 * Drops this device's token from the caller's row — e.g. before signing out, or
 * when the user turns mobile push off in Configurações.
 *
 * Best-effort by design: it needs a live session (the route authenticates the
 * bearer token), so it must run BEFORE supabase.auth.signOut(). If it doesn't,
 * the stale binding is still cleaned up server-side the next time anyone
 * registers this same token — see the route's cross-user purge.
 */
export async function unregisterPushNotifications(): Promise<boolean> {
  if (!Device.isDevice) return false

  const projectId = resolveProjectId()
  if (!projectId) return false

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    await api<{ ok: true }>('/api/push/expo', { method: 'DELETE', body: { token } })
    return true
  } catch {
    return false
  }
}

// ─── One registration per user, per app run ─────────────────────────────────
// The runtime hook is mounted by <NotificationsBell/>, which the nav shell
// renders on every screen — without this guard, every screen change would fire a
// token round trip.

const registeredUsers = new Map<string, Promise<PushRegistrationResult>>()

export function ensurePushRegistration(userId: string): Promise<PushRegistrationResult> {
  const pending = registeredUsers.get(userId)
  if (pending) return pending

  const registration = registerForPushNotifications().then((result) => {
    // A transient failure must not poison the cache for the whole session: drop
    // it so the next mount (e.g. back online) can try again. Permission denials
    // and simulators are terminal for this run — keep them cached and stay quiet.
    if (result.status === 'falha') registeredUsers.delete(userId)
    return result
  })

  registeredUsers.set(userId, registration)
  return registration
}

/** Sign-out must clear this, or signing back in would skip re-registration. */
export function resetPushRegistration(): void {
  registeredUsers.clear()
}
