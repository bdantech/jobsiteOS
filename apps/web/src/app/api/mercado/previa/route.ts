/**
 * POST /api/mercado/previa — the dry-run behind the Pirâmide's confirmation card.
 *
 * WHY A ROUTE AND NOT A BROWSER READ: the preview counts movements across the
 * WHOLE universe (~880k rows). Done in the browser under RLS it is a count that
 * blows past the `authenticated` role's 8s statement_timeout every time. So it
 * runs on the worker, which holds a direct pg connection (no timeout) and uses
 * compileToSql — the SAME compiler the reclassification applies — so the numbers
 * shown here cannot disagree with what confirming the rule will do.
 *
 * This route is the thin, authenticated bridge: it gates on the Mercado module,
 * forwards to the worker (WORKER_SECRET never leaves the server), and relays the
 * typed breakdown. maxDuration is raised because the scan outlives the default.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { arvoreSchema, camadaComRegraSchema, canAccessRoute } from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { preverRegraNoWorker } from '@/lib/mercado/worker'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** The worker scans the whole universe for the dry-run; it outlives the 15s default. */
export const maxDuration = 60

const schema = z.object({ camada: camadaComRegraSchema, definicao: arvoreSchema })

export async function POST(request: Request): Promise<Response> {
  const context = await getSessionContext()
  if (!context) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }
  if (!canAccessRoute('/mercado', context.grantedModuleIds)) {
    return NextResponse.json({ error: 'Sem acesso ao módulo Mercado.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Regra inválida para a prévia.' },
      { status: 400 },
    )
  }

  const resultado = await preverRegraNoWorker(parsed.data.camada, parsed.data.definicao)
  if (!resultado.ok) {
    // 502: the failure is upstream (worker unreachable or errored), not the client's.
    return NextResponse.json({ error: resultado.message }, { status: 502 })
  }

  return NextResponse.json(resultado.previsao)
}
