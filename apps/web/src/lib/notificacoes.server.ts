import 'server-only'

// ⚠️ RELATIVE IMPORT ON PURPOSE — DO NOT "TIDY" THIS INTO A PACKAGE SPECIFIER.
//
// `@jobsiteos/core/src/server/notify.js` does not resolve: core declares an
// `exports` map ({ ".", "./registry", "./schemas", "./types" }) and that subpath
// is not in it, so both tsc (moduleResolution: Bundler) and webpack reject it
// with "Cannot find module". core is off-limits to this agent, so the deep
// relative path is the only way in without touching it.
//
// The cost is contained to this one file precisely so nobody else pays it:
// every other module imports `notificar()` from here, not notify() from core.
// See the report — the real fix is one line in packages/core/package.json:
//   "./server/notify": "./src/server/notify.ts"
import {
  notify,
  type NotifyPayload,
  type NotifyResult,
} from '../../../../packages/core/src/server/notify.js'

import { createAdminClient } from '@/lib/supabase/admin'

export type { NotifyPayload, NotifyResult }

/**
 * The one way the app sends a notification. Writes the `notificacoes` rows (the
 * bell reads them over Realtime) and fans out to Web Push + Expo push for
 * whichever channels each recipient has actually registered.
 *
 * SERVER ONLY, and deliberately NOT a server action: `notify()` runs on the
 * service-role client, so if this were exported from a `'use server'` module
 * Next would mint an RPC endpoint for it and any authenticated browser could
 * push an arbitrary title/body/url to any user in the company. Callers must be
 * server code that has already authorised the send.
 *
 * Never throws on push-delivery problems — a dead browser subscription must not
 * roll back the caller's mutation. It only throws if the durable `notificacoes`
 * rows cannot be written, which is a real failure worth surfacing.
 */
export async function notificar(
  userIds: readonly string[],
  payload: NotifyPayload,
): Promise<NotifyResult> {
  // De-dup: two rules matching the same user must not produce two bells.
  const destinatarios = [...new Set(userIds)].filter((id) => id.length > 0)

  if (destinatarios.length === 0) {
    return { notificacoes: 0, webPushEnviados: 0, expoPushEnviados: 0, inscricoesRemovidas: 0 }
  }

  return notify(createAdminClient(), destinatarios, payload)
}
