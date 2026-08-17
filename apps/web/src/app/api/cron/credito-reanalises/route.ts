import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararDrenarAnalisesProprias, dispararSugerirReanalises } from '@/lib/mercado/worker'

/**
 * Diário da análise proprietária (04j §6) → apps/worker.
 *
 * Duas coisas, e nenhuma delas gasta token à toa:
 *
 * 1. SUGERE reanálise do que vence em menos de 60 dias. Sugerir é notificar; executar é
 *    ler dez PDFs num modelo. "Reanalisar tudo automaticamente" seria a forma mais cara
 *    possível de descobrir que a maioria das análises não mudou.
 * 2. Drena as análises que ficaram em `processando`. O disparo normal é síncrono ao
 *    clique, e um deploy no meio do caminho deixaria a análise parada para sempre — com
 *    alguém olhando um spinner que nunca resolve.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const sugestoes = await dispararSugerirReanalises()
  // A drenagem roda MESMO se a sugestão falhar: são independentes, e deixar de retomar
  // uma análise travada por causa de um erro no outro job seria trocar um problema por dois.
  const drenagem = await dispararDrenarAnalisesProprias()

  if (!sugestoes.ok && !drenagem.ok) {
    return NextResponse.json(
      { ok: false, job: 'credito-reanalises', erro: sugestoes.message },
      { status: sugestoes.code === 'config' ? 500 : 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    job: 'credito-reanalises',
    sugestoes: sugestoes.ok,
    drenagem: drenagem.ok,
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
