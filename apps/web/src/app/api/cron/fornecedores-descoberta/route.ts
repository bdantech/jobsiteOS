import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararDescobertaFornecedores } from '@/lib/mercado/worker'

/**
 * Camadas 0+1 da cascata de descoberta (04l §4.1), em lote.
 *
 * Roda de madrugada porque abre conexão HTTP com o site de terceiros e consulta o
 * Google Places — nada disso deve competir com o horário em que o originador está
 * usando a tela.
 *
 * O funil em si NÃO é atualizado aqui: ele roda atrás do sync de NF, porque a
 * munição é derivada exatamente das notas que acabaram de chegar.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const r = await dispararDescobertaFornecedores()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'fornecedores-descoberta', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({
    ok: true,
    job: 'fornecedores-descoberta',
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
