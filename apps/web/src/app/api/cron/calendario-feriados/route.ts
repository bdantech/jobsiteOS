import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararImportarFeriados } from '@/lib/mercado/worker'

/**
 * Feriados nacionais, uma vez por ano → apps/worker
 * (`POST /jobs/calendario/importar-feriados`).
 *
 * Alimenta `dias_nao_uteis`, que é o que a janela de novidades do funil (04t) lê para
 * saber qual foi o último expediente útil. O job traz o ano corrente e o seguinte;
 * estaduais, municipais e pontos facultativos são cadastro do gestor.
 *
 * Mesmo contrato dos outros crons: autentica com CRON_SECRET, faz o hand-off e volta.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  const resultado = await dispararImportarFeriados()

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'calendario-importar-feriados', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    job: 'calendario-importar-feriados',
    disparadoEm: new Date().toISOString(),
  })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
