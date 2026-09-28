import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararCriarMandatos } from '@/lib/mercado/worker'

/**
 * As regras ativas criam mandatos (Prompt 09 §2.3) → `POST /jobs/agentes/criar-mandatos`.
 *
 * 10:00 UTC = 07:00 em São Paulo, dias úteis: os mandatos nascem antes do expediente e
 * o primeiro ciclo da manhã já os pega.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararCriarMandatos()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'agentes-criar-mandatos', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'agentes-criar-mandatos', disparadoEm: new Date().toISOString() })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
