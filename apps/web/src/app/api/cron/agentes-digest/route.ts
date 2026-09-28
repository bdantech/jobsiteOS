import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararDigestAgentes } from '@/lib/mercado/worker'

/**
 * O digest diário de cada agente (Prompt 09 §13) → `POST /jobs/agentes/digest`.
 *
 * 21:00 UTC = 18:00 em São Paulo, dias úteis: o que fez, o que conseguiu, quanto custou e
 * o que planeja — lido no fim do dia, não no meio dele.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararDigestAgentes()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'agentes-digest', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'agentes-digest', disparadoEm: new Date().toISOString() })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
