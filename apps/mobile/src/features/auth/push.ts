import { BRAND_ACCENT } from '@jobsiteos/core'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

/**
 * The device half of push: OS permission + the Expo token. The account half
 * (prefs_notificacoes.push_mobile) lives on the server — notify() checks BOTH,
 * so a token with the preference off delivers nothing, by design.
 */

export type PushErroCodigo = 'simulador' | 'sem-projeto' | 'permissao-negada' | 'token'

export class PushError extends Error {
  readonly codigo: PushErroCodigo

  constructor(codigo: PushErroCodigo, message: string) {
    super(message)
    this.name = 'PushError'
    this.codigo = codigo
  }
}

/**
 * `Constants.expoConfig.extra` is typed as an index of `any`, so it is read
 * through `unknown` — an `any` leaking out of here would silently disable
 * type-checking at every call site.
 *
 * app.config.ts only sets `extra.eas.projectId` when EAS_PROJECT_ID is exported.
 * Without it Expo cannot mint a push token at all, which is a build/config fact,
 * not a user error: the UI says so and disables the switch instead of throwing.
 */
function lerProjectId(): string | null {
  const extra: unknown = Constants.expoConfig?.extra
  if (typeof extra !== 'object' || extra === null) return null

  const eas: unknown = (extra as Record<string, unknown>).eas
  if (typeof eas !== 'object' || eas === null) return null

  const projectId: unknown = (eas as Record<string, unknown>).projectId
  return typeof projectId === 'string' && projectId.length > 0 ? projectId : null
}

export interface PushAmbiente {
  /** A simulator has no push service and can never receive a notification. */
  dispositivoFisico: boolean
  /** EAS project id present in the build. */
  projetoConfigurado: boolean
  concedida: boolean
  /** False once the user has denied twice on iOS: only the OS settings can undo it. */
  podePerguntar: boolean
  /** Whether the switch can do anything at all. */
  disponivel: boolean
}

export async function inspecionarAmbientePush(): Promise<PushAmbiente> {
  const dispositivoFisico = Device.isDevice
  const projetoConfigurado = lerProjectId() !== null

  const { granted, canAskAgain } = await Notifications.getPermissionsAsync()

  return {
    dispositivoFisico,
    projetoConfigurado,
    concedida: granted,
    podePerguntar: canAskAgain,
    disponivel: dispositivoFisico && projetoConfigurado,
  }
}

/**
 * Android delivers nothing without a channel, and the token request is what
 * creates it. Name and id match app.json's `defaultChannel`.
 */
async function configurarCanalAndroid(): Promise<void> {
  if (Platform.OS !== 'android') return

  await Notifications.setNotificationChannelAsync('default', {
    name: 'Notificações',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: BRAND_ACCENT,
  })
}

/** `registrarPushExpoSchema` caps this at 120 chars. */
export function nomeDoDispositivo(): string {
  const nome = Device.deviceName ?? Device.modelName ?? Platform.OS
  return nome.slice(0, 120)
}

/** Asks for permission if needed, then mints the token. Throws PushError. */
export async function obterTokenPush(): Promise<string> {
  if (!Device.isDevice) {
    throw new PushError('simulador', 'Notificações push exigem um dispositivo físico.')
  }

  const projectId = lerProjectId()
  if (!projectId) {
    throw new PushError(
      'sem-projeto',
      'Este build não está configurado para notificações push. Fale com um administrador.',
    )
  }

  await configurarCanalAndroid()

  const atual = await Notifications.getPermissionsAsync()
  let concedida = atual.granted

  if (!concedida && atual.canAskAgain) {
    const solicitada = await Notifications.requestPermissionsAsync()
    concedida = solicitada.granted
  }

  if (!concedida) {
    throw new PushError(
      'permissao-negada',
      'Permissão de notificações negada. Libere nos ajustes do sistema.',
    )
  }

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId })
    return data
  } catch {
    // Network, or the device has no FCM/APNs registration. Nothing the user can
    // act on beyond retrying.
    throw new PushError('token', 'Não foi possível obter o token deste dispositivo. Tente novamente.')
  }
}

/**
 * The token, but only if permission is ALREADY granted — never prompts.
 *
 * Used when switching push off: prompting the user for permission in order to
 * turn notifications off would be absurd. Returns null when the token can't be
 * had, and the caller degrades gracefully.
 */
export async function obterTokenSeConcedido(): Promise<string | null> {
  try {
    const ambiente = await inspecionarAmbientePush()
    if (!ambiente.disponivel || !ambiente.concedida) return null

    const projectId = lerProjectId()
    if (!projectId) return null

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId })
    return data
  } catch {
    return null
  }
}
