import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararValidarContatos } from '@/lib/mercado/worker'

/**
 * Validação diária dos contatos descobertos (04l §4.4).
 *
 * Não envia nada e não disca: testa a forma do telefone e o registro MX do domínio
 * do e-mail. Contato inválido é REBAIXADO, nunca apagado — a linha ruim é a
 * evidência de que a fonte entrega lixo, e é ela que o painel de eficácia usa para
 * justificar desligar um provedor.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const r = await dispararValidarContatos()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'fornecedores-validar', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({
    ok: true,
    job: 'fornecedores-validar',
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
