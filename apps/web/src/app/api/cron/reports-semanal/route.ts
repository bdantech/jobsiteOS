import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { autorizarCron } from '../auth'
import { dispararReportSemanal } from '@/lib/mercado/worker'

/**
 * O Report Semanal Executivo (04q §5).
 *
 * ─── POR QUE O CRON RODA TODO DIA ───────────────────────────────────────────
 * Os dias de envio são CONFIGURÁVEIS na aba (`report_config.dias_semana`), e a Vercel só
 * entende cron fixo. Um cron de segunda cravado no `vercel.json` faria a configuração
 * mentir: o gestor marcaria "quarta" na tela e nada chegaria na quarta.
 *
 * Então o cron acorda todo dia e é ESTA rota que decide, lendo a configuração. Um dia que
 * não é dia de envio custa uma consulta e devolve `pulado`.
 *
 * O horário fica no cron, e não na configuração, de propósito: o `horario` da tabela é a
 * intenção de quem configurou; a Vercel dispara na hora do cron. Manter os dois em sintonia
 * é uma escolha de operação, e a tela avisa qual horário está de fato agendado.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/** Geração + modelo + PDF + upload + envio. O padrão de 10s não cobre isso. */
export const maxDuration = 300

export async function GET(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ ok: false, erro: 'Supabase não configurado.' }, { status: 500 })
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data: cfg, error } = await supabase
    .from('report_config')
    .select('ativo, dias_semana, timezone')
    .eq('tipo', 'semanal_executivo')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, erro: error.message }, { status: 502 })
  }
  if (!cfg?.ativo) {
    return NextResponse.json({ ok: true, job: 'reports-semanal', pulado: 'envio_desligado' })
  }

  /*
   * O dia da semana no fuso da CONFIGURAÇÃO, e não no do servidor. A Vercel roda em UTC:
   * um envio de segunda às 6h de São Paulo dispara às 9h UTC de segunda — mas um envio de
   * domingo às 22h dispararia às 01h UTC de SEGUNDA, e o servidor acharia que é outro dia.
   */
  const tz = cfg.timezone || 'America/Sao_Paulo'
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: tz })
  const diaIso = ((new Date(`${hoje}T12:00:00Z`).getUTCDay() + 6) % 7) + 1 // 1=seg … 7=dom

  if (!(cfg.dias_semana ?? []).includes(diaIso)) {
    return NextResponse.json({
      ok: true, job: 'reports-semanal', pulado: 'nao_e_dia', dia_iso: diaIso,
      dias_configurados: cfg.dias_semana,
    })
  }

  const r = await dispararReportSemanal({})
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'reports-semanal', erro: r.message },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  return NextResponse.json({ ok: true, job: 'reports-semanal', dia_iso: diaIso })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
