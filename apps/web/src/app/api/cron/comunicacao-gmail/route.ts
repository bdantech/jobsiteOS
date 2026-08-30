import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararGmailSync } from '@/lib/mercado/worker'

/**
 * Sync do Gmail (05A §3.2). É o FALLBACK do Pub/Sub — um canal de recebimento que depende só de push perde mensagens em silêncio.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararGmailSync()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'comunicacao-gmail', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'comunicacao-gmail', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
