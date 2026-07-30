import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararSincronizarCertificados, dispararSincronizarOnepay } from '@/lib/mercado/worker'

/**
 * Diário: sync dos clientes Onepay → apps/worker (`POST /jobs/radar/onepay`).
 *
 * Mesmo contrato dos crons do Mercado: autentica com CRON_SECRET, faz o hand-off
 * pro worker (que autentica com WORKER_SECRET) e volta. O worker puxa o
 * temperature-report, faz upsert em clientes_onepay + snapshot e emite eventos.
 *
 * ENCADEADO (04b §3): logo depois dispara o sync de certificados digitais, que vem do
 * mesmo BI. Um cron só para as duas fontes — e o de certificados NÃO é condicionado ao
 * sucesso do primeiro: são dados independentes, e deixar de saber que um certificado
 * vence porque o temperature-report caiu seria trocar um problema por outro pior.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  const resultado = await dispararSincronizarOnepay()
  const certificados = await dispararSincronizarCertificados()

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'radar-onepay', erro: resultado.message, certificados: certificados.ok },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    job: 'radar-onepay',
    certificados: certificados.ok ? 'disparado' : certificados.message,
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
