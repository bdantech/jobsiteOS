import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import {
  dispararSincronizarAnalisesPlataforma,
  dispararSincronizarCertificados,
  dispararSincronizarOnepay,
} from '@/lib/mercado/worker'

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
  /*
   * As análises de crédito vêm DEPOIS do temperature report, e a ordem é a regra
   * (04h §3): o temperature report é a fonte de verdade de "cliente atual", e a
   * detecção de ex-cliente consulta `clientes_onepay` para não rebaixar quem está
   * ativo. Rodar antes leria o estado de ontem e produziria conflitos fabricados.
   *
   * Não condicionado ao sucesso, pela mesma razão dos certificados: os jobs do
   * worker são assíncronos (202 na hora), então "esperar o primeiro" não é uma
   * garantia que este processo consiga dar — e deixar de detectar uma saída porque
   * o temperature report caiu troca um problema por outro.
   */
  const analises = await dispararSincronizarAnalisesPlataforma()

  if (!resultado.ok) {
    return NextResponse.json(
      {
        ok: false,
        job: 'radar-onepay',
        erro: resultado.message,
        certificados: certificados.ok,
        analises: analises.ok,
      },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    job: 'radar-onepay',
    certificados: certificados.ok ? 'disparado' : certificados.message,
    analises: analises.ok ? 'disparado' : analises.message,
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
