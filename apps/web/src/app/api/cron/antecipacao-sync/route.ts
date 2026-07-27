import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararSyncNfs } from '@/lib/mercado/worker'

/**
 * Sync de NFs, de 4 em 4 horas → apps/worker (`POST /jobs/antecipacao/sync-nfs`).
 *
 * A agenda do Prompt (§3) é 06:30, 10:30, 14:30, 18:30, 22:30, 02:30 em
 * America/São_Paulo. Vercel Cron é UTC e São Paulo é UTC−3 sem horário de verão
 * desde 2019, então isso é `30 9,13,17,21,1,5 * * *` — está em apps/web/vercel.json.
 *
 * Mesmo contrato dos outros crons: autentica com CRON_SECRET, faz o hand-off para
 * o worker (que autentica com WORKER_SECRET) e volta. Quem acompanha o resultado
 * é `mercado_ingestoes` (fonte `onepay_nf`) — a corrida leva minutos.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  const resultado = await dispararSyncNfs()

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'antecipacao-sync-nfs', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    job: 'antecipacao-sync-nfs',
    ingestaoId: resultado.ingestaoId,
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
