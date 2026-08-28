import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  FASE_LABELS,
  TIPO_PRAZO_LABELS,
  type Fase,
  type TipoPrazo,
} from '../../../../../packages/core/src/juridico/index.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { todasAsPaginas } from '../../paginar.js'
import { emitirEvento } from '../../radar/eventos.js'
import { lerBenchmarkFases, lerMonitoramento } from '../../juridico/config.js'
import { recalcularScoresDeCnpjs } from '../credito/potencial.js'
import { notificarAdvogado } from './notificar.js'

/**
 * Alertas diários do Jurídico (08 §5 e §9): fase lenta, processo parado, prazo a vencer.
 *
 * ── OS TRÊS ALERTAS SÃO IDEMPOTENTES POR DIA, E CADA UM DE UM JEITO ────────
 * `processo.fase_lenta` e `processo.sem_movimentacao` conferem `empresa_eventos`:
 * se o mesmo alerta já saiu nas últimas 24h para aquele CNJ, não sai de novo. Um
 * processo estourado fica estourado por semanas, e um aviso diário sobre um fato
 * que não mudou é como se ensina alguém a ignorar o sino.
 *
 * O aviso de prazo usa colunas próprias (`avisado_d3_em`, `avisado_d1_em`) e não a
 * janela de 24h: D-3 e D-1 são DOIS avisos distintos sobre o mesmo prazo, e uma
 * regra por tempo não conseguiria distingui-los.
 */

export interface ResultadoAlertas {
  fases_lentas: number
  parados: number
  prazos_d3: number
  prazos_d1: number
  /** Empresas cujo knockout de crédito estava dessincronizado do flag (08 §9). */
  scores_reconciliados: number
}

const DIA_MS = 86_400_000

/** Este alerta já saiu nas últimas 24h para este processo? */
async function jaAvisou(tipo: string, numeroCnj: string): Promise<boolean> {
  const desde = new Date(Date.now() - DIA_MS).toISOString()
  const { data } = await supabaseAdmin
    .from('empresa_eventos')
    .select('id')
    .eq('tipo', tipo)
    .gte('criado_em', desde)
    .contains('payload', { numero_cnj: numeroCnj })
    .limit(1)
  return (data ?? []).length > 0
}

export async function alertasJuridico(): Promise<ResultadoAlertas> {
  const [benchmark, cfg] = await Promise.all([lerBenchmarkFases(), lerMonitoramento()])
  const r: ResultadoAlertas = {
    fases_lentas: 0,
    parados: 0,
    prazos_d3: 0,
    prazos_d1: 0,
    scores_reconciliados: await reconciliarKnockouts(),
  }

  // ── Fase lenta e processo parado ──
  // Toda coluna da view chega anulável ao gerador de tipos, inclusive as que são
  // NOT NULL na tabela. O tipo acompanha isso em vez de mentir com um cast.
  const carteira = await todasAsPaginas<{
    numero_cnj: string | null
    empresa_devedora_id: string | null
    devedor_nome: string | null
    fase_atual: string | null
    dias_na_fase: number | null
    dias_sem_movimentacao: number | null
    situacao_interna: string | null
  }>((de, ate) =>
    supabaseAdmin
      .from('juridico_carteira')
      .select('numero_cnj, empresa_devedora_id, devedor_nome, fase_atual, dias_na_fase, dias_sem_movimentacao, situacao_interna')
      // Só o que está em curso: alertar sobre a lentidão de um processo GANHO é
      // pedir ação sobre algo que já acabou.
      .in('situacao_interna', ['em_andamento', 'suspenso', 'acordo'])
      .range(de, ate),
  )

  for (const p of carteira) {
    if (!p.numero_cnj) continue
    const fase = p.fase_atual as Fase | null
    const limite = fase ? (benchmark[fase] ?? null) : null

    if (fase && limite !== null && (p.dias_na_fase ?? 0) > limite && !(await jaAvisou('processo.fase_lenta', p.numero_cnj))) {
      r.fases_lentas++
      const label = FASE_LABELS[fase] ?? fase
      await emitirEvento(p.empresa_devedora_id, EVENTO_TIPOS.PROCESSO_FASE_LENTA, {
        titulo: 'Fase do processo estourou o prazo esperado',
        resumo: `${p.numero_cnj} está em "${label}" há ${p.dias_na_fase} dias (esperado: ${limite}).`,
        url: `/juridico/${p.numero_cnj}`,
        numero_cnj: p.numero_cnj,
        fase,
        dias: p.dias_na_fase,
        benchmark: limite,
      })
      await notificarAdvogado(p.numero_cnj, {
        titulo: 'Processo lento',
        corpo: `${p.numero_cnj}: ${p.dias_na_fase} dias em "${label}" (esperado ${limite}).`,
        url: `/juridico/${p.numero_cnj}`,
      })
    }

    if (
      (p.dias_sem_movimentacao ?? 0) > cfg.dias_sem_movimentacao &&
      !(await jaAvisou('processo.sem_movimentacao', p.numero_cnj))
    ) {
      r.parados++
      await emitirEvento(p.empresa_devedora_id, EVENTO_TIPOS.PROCESSO_SEM_MOVIMENTACAO, {
        titulo: 'Processo parado',
        resumo: `${p.numero_cnj} está sem movimentação há ${p.dias_sem_movimentacao} dias.`,
        url: `/juridico/${p.numero_cnj}`,
        numero_cnj: p.numero_cnj,
        dias: p.dias_sem_movimentacao,
      })
    }
  }

  // ── Prazos a vencer (D-3 e D-1) ──
  const agora = Date.now()
  const { data: prazos } = await supabaseAdmin
    .from('processo_prazos')
    .select('id, numero_cnj, tipo, descricao, data, avisado_d3_em, avisado_d1_em')
    .eq('concluido', false)
    .gte('data', new Date(agora).toISOString())
    .lte('data', new Date(agora + 4 * DIA_MS).toISOString())
    .order('data')

  for (const prazo of prazos ?? []) {
    const faltamDias = (Date.parse(prazo.data) - agora) / DIA_MS
    const rotulo = TIPO_PRAZO_LABELS[prazo.tipo as TipoPrazo] ?? prazo.tipo

    /*
     * D-1 é conferido ANTES de D-3, e a ordem não é estética: um prazo criado com
     * dois dias de antecedência nunca passa pela janela de D-3. Testar D-3 primeiro
     * marcaria `avisado_d3_em` no mesmo dia em que D-1 deveria disparar, e o aviso
     * que importa — o da véspera — sairia como se fosse o de três dias antes.
     */
    if (faltamDias <= 1 && !prazo.avisado_d1_em) {
      r.prazos_d1++
      await notificarAdvogado(prazo.numero_cnj, {
        titulo: `${rotulo} amanhã`,
        corpo: `${prazo.descricao} — processo ${prazo.numero_cnj}.`,
        url: `/juridico/${prazo.numero_cnj}`,
      })
      await supabaseAdmin
        .from('processo_prazos')
        .update({ avisado_d1_em: new Date().toISOString() })
        .eq('id', prazo.id)
      continue
    }

    if (faltamDias <= 3 && !prazo.avisado_d3_em) {
      r.prazos_d3++
      await notificarAdvogado(prazo.numero_cnj, {
        titulo: `${rotulo} em 3 dias`,
        corpo: `${prazo.descricao} — processo ${prazo.numero_cnj}.`,
        url: `/juridico/${prazo.numero_cnj}`,
      })
      await supabaseAdmin
        .from('processo_prazos')
        .update({ avisado_d3_em: new Date().toISOString() })
        .eq('id', prazo.id)
    }
  }

  logger.info(r, 'Alertas do Jurídico emitidos.')
  return r
}

/**
 * Reconcilia o knockout de crédito com o flag de processo ativo (08 §9).
 *
 * O flag em `empresas.tem_processo_nosso_ativo` é mantido por trigger e está sempre
 * certo. O SCORE é cache, e ele muda por outro caminho — alguém marcar o processo
 * como "ganho" na tela roda um RPC em SQL que não tem como chamar o worker. Sem esta
 * varredura, a empresa continuaria bloqueada para crédito depois de a ação ter
 * acabado, e ninguém saberia por quê.
 *
 * ── `empresa_scores` É APPEND-ONLY, E ISSO MUDA A CONSULTA ─────────────────
 * Procurar "existe linha com knockout = processo_nosso_ativo" acharia a pontuação de
 * seis meses atrás de uma empresa cujo processo já acabou — e ela seria repontuada
 * todo dia, para sempre, sem nunca sair da lista. O que interessa é o knockout da
 * linha MAIS RECENTE de cada CNPJ, e é ele que se compara com o flag.
 */
async function reconciliarKnockouts(): Promise<number> {
  const { data: comProcesso } = await supabaseAdmin
    .from('empresas')
    .select('cnpj')
    .eq('tem_processo_nosso_ativo', true)
  const comFlag = new Set((comProcesso ?? []).map((e) => e.cnpj))

  /*
   * Os candidatos são os CNPJs que têm processo AGORA mais os que JÁ TIVERAM — estes
   * últimos são exatamente os que podem ter ficado com o knockout preso. Sair de
   * `processos` e não de `empresa_scores` mantém a lista pequena: ela é do tamanho da
   * carteira judicial, não da base de sacados.
   */
  const { data: jaTiveram } = await supabaseAdmin
    .from('processos')
    .select('cnpj_devedor')
    .not('cnpj_devedor', 'is', null)
  const candidatos = [
    ...new Set([...comFlag, ...(jaTiveram ?? []).map((p) => p.cnpj_devedor).filter((c): c is string => !!c)]),
  ]
  if (candidatos.length === 0) return 0

  const { data: scores } = await supabaseAdmin
    .from('empresa_scores')
    .select('cnpj, knockout, calculado_em')
    .in('cnpj', candidatos)
    .order('calculado_em', { ascending: false })

  // A primeira linha de cada CNPJ é a mais recente — a ordem já veio decrescente.
  const knockoutAtual = new Map<string, string | null>()
  for (const s of scores ?? []) {
    if (!knockoutAtual.has(s.cnpj)) knockoutAtual.set(s.cnpj, s.knockout)
  }

  const paraRepontuar = candidatos.filter((cnpj) => {
    const temFlag = comFlag.has(cnpj)
    const temKnockout = knockoutAtual.get(cnpj) === 'processo_nosso_ativo'
    // Nunca pontuada e sem processo: não há nada a reconciliar. Nunca pontuada COM
    // processo entra, porque o score dela vai nascer já bloqueado.
    if (!knockoutAtual.has(cnpj) && !temFlag) return false
    return temFlag !== temKnockout
  })

  if (paraRepontuar.length === 0) return 0

  try {
    const acc = await recalcularScoresDeCnpjs(paraRepontuar)
    logger.info({ cnpjs: paraRepontuar.length }, 'Knockouts de processo reconciliados.')
    return acc.avaliados
  } catch (e) {
    logger.error({ erro: String(e) }, 'Falha ao reconciliar knockouts de processo.')
    return 0
  }
}
