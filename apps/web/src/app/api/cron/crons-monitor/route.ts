import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { monitorarCrons } from '@/lib/crons-monitor.server'

/**
 * A cada cinco minutos: confere a agenda contra os disparos registrados e avisa os
 * admins do que falhou (0272). Não fala com o worker — é quando ele cai que isto
 * mais precisa rodar. A lógica está em `lib/crons-monitor.server.ts`.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  try {
    const r = await monitorarCrons()
    return NextResponse.json({ ok: true, job: 'crons-monitor', ...r })
  } catch (erro) {
    return NextResponse.json(
      { ok: false, job: 'crons-monitor', erro: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 },
    )
  }
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
