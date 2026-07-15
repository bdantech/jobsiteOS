import 'server-only'

import { timingSafeEqual } from 'node:crypto'

/**
 * Guard for every /api/cron/* route. These are public URLs on the internet, so
 * without this anyone could trigger a digest run, a portfolio re-check, or
 * whatever future modules hang off cron.
 *
 * NOT a route file — Next only treats `route.ts` as an endpoint, so this sits
 * safely alongside them.
 */

/** Constant-time compare, so the secret can't be recovered by timing the 401. */
function segredosBatem(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido, 'utf8')
  const b = Buffer.from(esperado, 'utf8')
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export type CronAuth = { ok: true } | { ok: false; motivo: string }

export function autorizarCron(request: Request): CronAuth {
  const esperado = process.env.CRON_SECRET

  // Fail closed. A misconfigured deploy must not silently expose open cron
  // endpoints — it must break loudly instead.
  if (esperado === undefined || esperado.length === 0) {
    return { ok: false, motivo: 'CRON_SECRET não configurado.' }
  }

  // Path 1 — Vercel Cron sets this automatically whenever CRON_SECRET is defined
  // in project env, and it is also what a manual/curl invocation uses.
  const authorization = request.headers.get('authorization')
  if (authorization !== null && authorization.toLowerCase().startsWith('bearer ')) {
    if (segredosBatem(authorization.slice(7).trim(), esperado)) {
      return { ok: true }
    }
  }

  // Path 2 — the x-vercel-cron header, but ONLY on Vercel. Vercel strips inbound
  // x-vercel-* headers from external requests, so there it is trustworthy; off
  // Vercel (local, self-hosted, a preview behind another proxy) it is just an
  // attacker-supplied string and must never authorise anything.
  if (process.env.VERCEL === '1' && request.headers.get('x-vercel-cron') !== null) {
    return { ok: true }
  }

  return { ok: false, motivo: 'Não autorizado.' }
}
