'use server'

import { canAccessRoute } from '@jobsiteos/core'
import { getSessionContext, isAdmin } from '@/lib/auth'
import { dispararPromocao } from '@/lib/mercado/worker'

/**
 * On-demand promotion (§3.2.5): turn every SAM+SOM company not yet in `empresas`
 * into a CRM row. Promotion USED to piggyback on every reclassification/ingestion,
 * which made routine jobs into 30-minute IO storms; it is now this deliberate,
 * admin-triggered action, batched and resumable on the worker.
 *
 * Every export of a 'use server' module is a public RPC endpoint, so this file
 * exports exactly ONE function and its first statements are the auth checks. The
 * WORKER_SECRET never leaves the server — the browser gets back only a sentence.
 */
export type PromoverResult = { ok: true; message: string } | { ok: false; message: string }

export async function promoverAgoraAction(): Promise<PromoverResult> {
  const context = await getSessionContext()
  if (!context) {
    return { ok: false, message: 'Sua sessão expirou. Entre novamente para continuar.' }
  }
  if (!canAccessRoute('/mercado', context.grantedModuleIds) || !isAdmin(context)) {
    return { ok: false, message: 'Apenas administradores podem promover empresas.' }
  }

  const resultado = await dispararPromocao()
  if (!resultado.ok) return { ok: false, message: resultado.message }

  return {
    ok: true,
    message:
      'Promoção disparada no worker. Ela roda em lotes e pode levar alguns minutos — acompanhe a base em Empresas.',
  }
}
