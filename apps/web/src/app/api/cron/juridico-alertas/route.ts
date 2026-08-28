import { NextResponse } from 'next/server'
import { autorizarCron } from '../auth'
import { dispararAlertasJuridico } from '@/lib/mercado/worker'

/**
 * Alertas diários do Jurídico (08 §5 e §9): fase lenta, processo parado e prazo a
 * vencer (D-3 e D-1) → apps/worker (`POST /jobs/juridico/alertas`).
 *
 * ── TODO DIA, INCLUSIVE NOS DIAS QUE NÃO SINCRONIZAM ───────────────────────
 * A sincronização segue a agenda configurada; os alertas não. Uma audiência marcada
 * para terça precisa do aviso de segunda mesmo que segunda não seja dia de
 * sincronizar — o prazo corre pelo calendário do fórum, não pelo nosso.
 *
 * Roda DEPOIS da sincronização (11:00 UTC contra 10:00): os dias parados e os dias
 * na fase são contados sobre o que acabou de chegar, e não sobre o de ontem.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const resultado = await dispararAlertasJuridico()
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, job: 'juridico-alertas', erro: resultado.message },
      { status: resultado.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'juridico-alertas', disparadoEm: new Date().toISOString() })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
