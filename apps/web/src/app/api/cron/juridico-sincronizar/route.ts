import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararSincronizarJuridico } from '@/lib/mercado/worker'

/**
 * Sincronização do Jurídico (08 §4) → apps/worker (`POST /jobs/juridico/sincronizar`).
 *
 * ── DISPARA TODO DIA, MAS NEM TODO DIA RODA ────────────────────────────────
 * A AGENDA vive em `juridico_config.monitoramento.dias_semana` e é conferida DENTRO
 * do job. Codificar os dias aqui, no `vercel.json`, obrigaria um deploy para mudar a
 * agenda — e ela é justamente a setting que o gestor mexe na tela, porque é ela que
 * decide o custo em créditos do Escavador.
 *
 * O job devolve `executado: false` com o motivo nos dias que não são de rodar, e
 * isso não é falha: é a agenda funcionando.
 *
 * A hora (07:00 em São Paulo = 10:00 UTC) é antes do expediente de propósito: quem
 * abre o Jurídico de manhã precisa das movimentações da noite já classificadas.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararSincronizarJuridico({})
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'juridico-sincronizar', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({
    ok: true,
    job: 'juridico-sincronizar',
    disparadoEm: new Date().toISOString(),
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
