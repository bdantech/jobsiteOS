import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararSincronizarSeguidos } from '@/lib/mercado/worker'

/**
 * Espelha as titularidades de cedente em `fornecedores_seguidos` (04r §2) e recompõe o
 * funil em seguida.
 *
 * Diário, e de madrugada, porque é ele que decide DE QUEM É cada card: um originador
 * que ganhou a titularidade de um cedente ontem precisa abrir a tela hoje já vendo os
 * sacados dele — e não descobrir pela metade ao longo do dia, conforme os syncs de NF
 * forem rodando.
 *
 * Roda ANTES do diário da Antecipação (05h): a lista de seguidos é a entrada do funil,
 * e recompô-lo com a lista de ontem seria fazer o trabalho duas vezes.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const r = await dispararSincronizarSeguidos()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'prospeccao-seguidos', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({
    ok: true,
    job: 'prospeccao-seguidos',
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
