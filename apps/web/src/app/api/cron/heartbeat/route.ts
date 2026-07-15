import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'

/**
 * Cron plumbing, intentionally doing no real work yet.
 *
 * Its job in this phase is to prove the secured path end to end: Vercel Cron →
 * CRON_SECRET check → an authenticated handler that can reach the service role
 * and notificar(). Future scheduled jobs (Carteira health checks, Cobrança
 * escalation, notification digests) are new files next to this one that start
 * with the same three lines.
 *
 * It also doubles as a liveness probe: hitting it with the secret tells you the
 * schedule is wired and the secret matches, which is otherwise invisible until
 * the first real job silently fails to run.
 */

// Never prerender or cache: this reads headers and must execute per request.
export const dynamic = 'force-dynamic'
// node:crypto (timing-safe compare) is not available on the edge runtime.
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)

  if (!auth.ok) {
    // No detail in the body: an unauthorised caller learns nothing about why.
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  return NextResponse.json({
    ok: true,
    job: 'heartbeat',
    executadoEm: new Date().toISOString(),
  })
}

// Vercel Cron issues GET. POST is here so the same job can be triggered manually
// (curl with the bearer secret) without a second, differently-guarded route.
export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
