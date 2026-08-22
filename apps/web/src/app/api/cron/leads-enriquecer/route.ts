import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararEnriquecerLeads } from '@/lib/mercado/worker'

/**
 * Rede de segurança do enriquecimento de leads (04i) → apps/worker.
 *
 * O caminho normal é o próprio endpoint do formulário acordar o worker assim que a
 * submissão entra. Este cron existe para o que aquele caminho perde: worker fora do ar,
 * deploy no meio do envio, um erro de rede entre a Vercel e o Railway. Sem ele, um lead
 * ficaria para sempre sem domínio e sem score — e ninguém descobriria, porque o lead
 * aparece na lista de qualquer jeito, só que sem a nota que define a ordem da fila.
 *
 * De hora em hora, e não diário: o valor de enriquecer um lead cai rápido: um SDR que
 * liga hoje de manhã não se beneficia de um score que chega amanhã. A varredura é barata
 * quando não há nada pendente — um índice parcial e nenhuma linha.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const r = await dispararEnriquecerLeads()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'leads-enriquecer', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'leads-enriquecer', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
