import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararQualidadeVigiar } from '@/lib/mercado/worker'

/**
 * O vigia da gravação de reuniões (05C §1.4): alerta quando o bot não entra, envia os resgates
 * na fila e retoma webhooks do Fireflies que não fecharam.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararQualidadeVigiar()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'qualidade-vigiar', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'qualidade-vigiar', disparadoEm: new Date().toISOString() })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
