import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararSyncFontesDoFunil } from '@/lib/mercado/worker'

/**
 * Pré-autorizações e títulos Sienge, de hora em hora → apps/worker
 * (`POST /jobs/funil/sync-fontes`).
 *
 * A NF sincroniza de 4 em 4 horas porque é assim que ela chega em produção. As duas
 * fontes novas do funil entram a todo momento, então ganham relógio próprio.
 *
 * A agenda (apps/web/vercel.json) é o minuto 30 de toda hora MENOS as do sync de NFs
 * (`30 9,13,17,21,1,5` UTC): aquela corrente já traz as duas fontes logo depois das
 * notas, e disparar as duas no mesmo minuto seria pedir as mesmas páginas duas vezes.
 * Juntas, as duas agendas dão uma corrida por hora.
 *
 * Mesmo contrato dos outros crons: autentica com CRON_SECRET, faz o hand-off e volta.
 * O worker responde 409 se outra corrida das fontes estiver em curso, e a execução
 * fecha como `pulada`. Quem acompanha o resultado é `mercado_ingestoes` (fontes
 * `onepay_pre_autorizacoes` e `onepay_sienge_titulos`).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  const resultado = await dispararSyncFontesDoFunil()

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'funil-sync-fontes', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    job: 'funil-sync-fontes',
    disparadoEm: new Date().toISOString(),
  })
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
