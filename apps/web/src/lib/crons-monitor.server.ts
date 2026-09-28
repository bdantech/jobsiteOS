import 'server-only'

import {
  CRONS,
  JANELA_AVISO_HORAS,
  LIMITE_SEM_RETORNO_HORAS,
  faltasNaAgenda,
} from '@jobsiteos/core'
import { avisarEContar } from '@/lib/notificacoes.server'
import { createAdminClient } from '@/lib/supabase/admin'
import vercel from '../../vercel.json'

/**
 * O monitor das rotinas agendadas (0272), a cada cinco minutos.
 *
 * Roda na VERCEL e não no worker, de propósito: a falha que o fez nascer foi o worker
 * fora do ar, e um monitor que dependesse dele cairia junto com o que monitora. Daqui
 * ele fala direto com o banco e entrega push e e-mail sem passar pelo Railway.
 *
 * Três passos, e depois o aviso:
 *   1. horário da agenda que passou sem disparo  → linha `nao_executou`;
 *   2. job `executando` além do limite            → `falhou` (worker reiniciou no meio);
 *   3. linhas com mais de 45 dias                 → apagadas;
 *   4. falhas ainda não avisadas                  → UM aviso por passada, com todas.
 *
 * O aviso não repete a mesma rotina dentro de seis horas: com o worker fora do ar,
 * as rotinas de cinco em cinco minutos falhariam doze vezes por hora cada uma, e um
 * aviso que chega sessenta vezes deixa de ser lido na terceira.
 */

const RETENCAO_DIAS = 45

const nomePorPath = new Map(CRONS.map((c) => [c.path, c.nome]))
const limitePorPath = new Map(CRONS.map((c) => [c.path, c.limiteSemRetornoHoras ?? LIMITE_SEM_RETORNO_HORAS]))

export interface ResultadoMonitor {
  faltas: number
  sem_retorno: number
  avisadas: number
  suprimidas: number
}

export async function monitorarCrons(agora: Date = new Date()): Promise<ResultadoMonitor> {
  const admin = createAdminClient()

  // ── 1. Faltas na agenda ──────────────────────────────────────────────────
  let faltas = 0
  const { data: primeiro } = await admin
    .from('cron_execucoes')
    .select('iniciado_em')
    .neq('status', 'nao_executou')
    .order('iniciado_em', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (primeiro) {
    const { data: ultimas, error } = await admin
      .from('cron_execucoes_ultimas')
      .select('path, ultimo_disparo_em')
    if (error) throw new Error(`Falha ao ler as últimas execuções: ${error.message}`)

    const ultimoDisparo = new Map<string, Date>()
    for (const u of ultimas ?? []) {
      if (u.path && u.ultimo_disparo_em) ultimoDisparo.set(u.path, new Date(u.ultimo_disparo_em))
    }

    for (const f of faltasNaAgenda(vercel.crons, ultimoDisparo, agora, new Date(primeiro.iniciado_em))) {
      const esperado = f.esperado_em.toISOString()
      const { error: erroFalta } = await admin.from('cron_execucoes').insert({
        path: f.path,
        status: 'nao_executou',
        esperado_em: esperado,
        // Ordena pelo horário previsto: um disparo atrasado que chegue depois passa
        // a ser a "última execução", como deve.
        iniciado_em: esperado,
        terminado_em: agora.toISOString(),
        erro: 'A agenda previa um disparo neste horário e nenhum chegou — Vercel não chamou a rota, ou ela caiu antes de registrar.',
      })
      // 23505: a mesma falta já registrada numa passada anterior.
      if (!erroFalta) faltas++
      else if (erroFalta.code !== '23505') throw new Error(`Falha ao registrar falta: ${erroFalta.message}`)
    }
  }

  // ── 2. Sem retorno do worker ─────────────────────────────────────────────
  const menorLimite = Math.min(LIMITE_SEM_RETORNO_HORAS, ...limitePorPath.values())
  const { data: presas } = await admin
    .from('cron_execucoes')
    .select('id, path, iniciado_em')
    .eq('status', 'executando')
    .lt('iniciado_em', new Date(agora.getTime() - menorLimite * 3_600_000).toISOString())

  let semRetorno = 0
  for (const p of presas ?? []) {
    const limite = limitePorPath.get(p.path) ?? LIMITE_SEM_RETORNO_HORAS
    if (agora.getTime() - new Date(p.iniciado_em).getTime() <= limite * 3_600_000) continue
    const { error } = await admin
      .from('cron_execucoes')
      .update({
        status: 'falhou',
        terminado_em: agora.toISOString(),
        erro: `Sem retorno do worker em ${limite}h — provavelmente ele reiniciou no meio do job (deploy ou queda).`,
      })
      .eq('id', p.id)
      .eq('status', 'executando')
    if (!error) semRetorno++
  }

  // ── 3. Retenção ──────────────────────────────────────────────────────────
  await admin
    .from('cron_execucoes')
    .delete()
    .lt('iniciado_em', new Date(agora.getTime() - RETENCAO_DIAS * 86_400_000).toISOString())

  // ── 4. O aviso ───────────────────────────────────────────────────────────
  const { avisadas, suprimidas } = await avisarFalhas(admin, agora)

  return { faltas, sem_retorno: semRetorno, avisadas, suprimidas }
}

async function avisarFalhas(
  admin: ReturnType<typeof createAdminClient>,
  agora: Date,
): Promise<{ avisadas: number; suprimidas: number }> {
  const { data: pendentes, error } = await admin
    .from('cron_execucoes')
    .select('id, path, status, iniciado_em, esperado_em, erro')
    .in('status', ['falhou', 'nao_executou'])
    .is('aviso', null)
    .order('iniciado_em', { ascending: true })
  if (error) throw new Error(`Falha ao ler as falhas pendentes: ${error.message}`)
  if (!pendentes?.length) return { avisadas: 0, suprimidas: 0 }

  // Rotinas que já AVISARAM na janela. Só `enviado` conta: uma supressão contando como
  // aviso faria uma falha contínua se calar para sempre.
  const { data: recentes } = await admin
    .from('cron_execucoes')
    .select('path')
    .eq('aviso', 'enviado')
    .gt('notificado_em', new Date(agora.getTime() - JANELA_AVISO_HORAS * 3_600_000).toISOString())
  const jaAvisadas = new Set((recentes ?? []).map((r) => r.path))

  // Uma linha por rotina no aviso — a mais recente — e as outras pendentes dela junto.
  const porPath = new Map<string, (typeof pendentes)[number]>()
  for (const p of pendentes) porPath.set(p.path, p)

  const aAvisar = [...porPath.values()].filter((p) => !jaAvisadas.has(p.path))
  const idsAvisados = pendentes.filter((p) => aAvisar.some((a) => a.path === p.path)).map((p) => p.id)
  const idsSuprimidos = pendentes.filter((p) => jaAvisadas.has(p.path)).map((p) => p.id)

  if (aAvisar.length) {
    const nomes = aAvisar.map((p) => nomePorPath.get(p.path) ?? p.path)
    const hora = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    const linhas = aAvisar.map((p) => {
      const quando = hora.format(new Date(p.esperado_em ?? p.iniciado_em))
      const oque = p.status === 'nao_executou' ? 'não rodou' : 'falhou'
      return `• ${nomePorPath.get(p.path) ?? p.path} — ${oque} (${quando})${p.erro ? `: ${p.erro.slice(0, 200)}` : ''}`
    })

    // Lança se o aviso não pôde ser gravado: as linhas ficam pendentes para a próxima passada.
    await avisarEContar('plataforma.cron_falhou', {
      titulo:
        aAvisar.length === 1
          ? `Rotina agendada falhou: ${nomes[0]}`
          : `${aAvisar.length} rotinas agendadas falharam`,
      resumo: linhas.join('\n'),
      url: '/admin/crons',
      rotinas: nomes,
      quantidade: aAvisar.length,
    })

    await admin
      .from('cron_execucoes')
      .update({ aviso: 'enviado', notificado_em: agora.toISOString() })
      .in('id', idsAvisados)
  }

  if (idsSuprimidos.length) {
    await admin
      .from('cron_execucoes')
      .update({ aviso: 'suprimido', notificado_em: agora.toISOString() })
      .in('id', idsSuprimidos)
  }

  return { avisadas: aAvisar.length, suprimidas: idsSuprimidos.length }
}
