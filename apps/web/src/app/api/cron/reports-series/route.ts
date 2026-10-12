import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { autorizarCron } from '../auth'
import { comRegistro } from '../registro'
import { dispararMaterializarSeriesReport } from '@/lib/mercado/worker'

/**
 * Diário, de madrugada: a série mensal que sustenta a média de 12 meses do report.
 *
 * Antes do envio, e não depois: a média é a régua de todos os indicadores, e um report
 * gerado sobre uma série de ontem compararia a semana com uma base defasada de um dia — o
 * bastante para o primeiro dia de um mês novo comparar contra o mês que acabou de fechar
 * sem estar fechado.
 *
 * ─── E A AQUISIÇÃO SEMANAL (04u §5) ─────────────────────────────────────────
 * O mesmo cron reescreve `report_aquisicao_semanal`: as treze semanas FECHADAS mais
 * recentes. Todas, e não só a que acabou de fechar — o fit de um lead da semana 38 definido
 * ontem muda a linha da semana 38.
 *
 * Daqui, direto no banco, e não pelo worker: é uma função SQL de milissegundos, e o worker
 * só sobe com deploy manual — pendurar isto nele faria a tabela ficar parada até alguém
 * lembrar do Railway. As duas metades são independentes: uma falhar não impede a outra.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function executar(request: Request): Promise<NextResponse> {
  const auth = autorizarCron(request)
  if (!auth.ok) return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })

  const aquisicao = await materializarAquisicao()

  const r = await dispararMaterializarSeriesReport()
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, job: 'reports-series', erro: r.message, aquisicao },
      { status: r.code === 'config' ? 500 : 502 },
    )
  }
  if ('erro' in aquisicao) {
    return NextResponse.json({ ok: false, job: 'reports-series', aquisicao }, { status: 502 })
  }
  return NextResponse.json({ ok: true, job: 'reports-series', aquisicao })
}

async function materializarAquisicao(): Promise<{ semanas: number; linhas: number } | { erro: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { erro: 'Supabase não configurado.' }
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await supabase.rpc('app_report_materializar_aquisicao', { p_semanas: 13 })
  if (error) return { erro: error.message }
  const d = (data ?? {}) as { semanas?: number; linhas?: number }
  return { semanas: d.semanas ?? 0, linhas: d.linhas ?? 0 }
}

export const GET = comRegistro(executar)

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
