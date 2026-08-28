// Caminhos ESPECÍFICOS, nunca o barrel do core (ver a nota em radar/funcionarios.ts).
import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  calcularPotencial,
  calibrarCredito,
  coeficientesVazios,
  type CoeficientesCredito,
  type ParametrosEconomia,
  type ParametrosLimite,
} from '../../../../../packages/core/src/credito/economia.js'
import {
  calcularScore,
  chanceDaFaixa,
  type DefinicaoScorecard,
  type FaixaScore,
  type ParametrosScore,
  type SinaisScore,
} from '../../../../../packages/core/src/credito/score.js'
import type { Json } from '../../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { todasAsPaginas } from '../../paginar.js'
import { emitirEvento } from '../../radar/eventos.js'
import { lerConfigCredito } from '../../credito/config.js'

/**
 * O motor do módulo Crédito (04d §2 e §3): calibrar na carteira, pontuar a base,
 * calcular o potencial.
 *
 * Os três jobs deste arquivo compartilham uma disciplina: **nenhum deles escreve número
 * quando falta a régua**. Sem clientes declarantes não há `ratio_limite`; sem
 * `ratio_limite` não há limite; sem limite não há valor esperado. Preencher com um
 * default deixaria a base inteira de números plausíveis e errados — e plausível é
 * exatamente o que ninguém questiona.
 */

const SACADOS = ['construtora', 'incorporadora']

// ─── §2.1 Calibração ────────────────────────────────────────────────────────

export async function calibrarCreditoJob(): Promise<{
  status: 'ok' | 'sem_clientes'
  versao?: number
  ratio_global?: number | null
  giro?: number | null
  n_clientes?: number
  n_declarantes?: number
}> {
  const { data: clientes } = await supabaseAdmin
    .from('clientes_onepay')
    .select('cnpj, credit_limit, gross_value_last_2m, empresa_id')
  if (!clientes?.length) {
    logger.warn('Sem clientes Onepay; nada a calibrar.')
    return { status: 'sem_clientes' }
  }

  const ids = clientes.map((c) => c.empresa_id).filter((id): id is string => id !== null)
  const { data: empresas } = ids.length
    ? await supabaseAdmin
        .from('empresas')
        .select('id, tipo, faturamento_anual, faturamento_origem')
        .in('id', ids)
    : { data: [] }

  const porId = new Map((empresas ?? []).map((e) => [e.id, e]))

  const amostras = clientes.map((c) => {
    const e = c.empresa_id ? porId.get(c.empresa_id) : undefined
    return {
      tipo: e?.tipo ?? null,
      credit_limit: c.credit_limit,
      gross_value_last_2m: c.gross_value_last_2m,
      // SÓ declaração conta para o ratio. Calibrar contra uma estimativa e depois
      // aplicar o coeficiente sobre estimativas fecharia o circuito em si mesmo: o
      // modelo confirmaria o próprio chute e o erro nunca apareceria.
      faturamento_declarado:
        e?.faturamento_origem === 'declarado_cliente' ? e.faturamento_anual : null,
    }
  })

  const cfg = await lerConfigCredito()
  const coef = calibrarCredito(amostras, cfg.n_minimo_calibracao_por_tipo)

  const { data: ultima } = await supabaseAdmin
    .from('credito_versoes')
    .select('versao')
    .order('versao', { ascending: false })
    .limit(1)
    .maybeSingle()
  const versao = (ultima?.versao ?? 0) + 1

  await supabaseAdmin.from('credito_versoes').update({ ativa: false }).eq('ativa', true)
  await supabaseAdmin.from('credito_versoes').insert({
    versao,
    coeficientes: coef as unknown as Json,
    n_amostras_por_tipo: { total: coef.n_clientes, declarantes: coef.n_declarantes } as Json,
    ativa: true,
  })

  logger.info(
    { versao, ratio: coef.ratio_limite.global, giro: coef.giro_mensal, declarantes: coef.n_declarantes },
    'Crédito calibrado.',
  )

  return {
    status: 'ok',
    versao,
    ratio_global: coef.ratio_limite.global,
    giro: coef.giro_mensal,
    n_clientes: coef.n_clientes,
    n_declarantes: coef.n_declarantes,
  }
}

async function versaoAtiva(): Promise<{ versao: number; coef: CoeficientesCredito } | null> {
  const { data } = await supabaseAdmin
    .from('credito_versoes')
    .select('versao, coeficientes')
    .eq('ativa', true)
    .order('calibrado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { versao: data.versao, coef: data.coeficientes as unknown as CoeficientesCredito }
}

// ─── §3 Scores ──────────────────────────────────────────────────────────────

interface LinhaSacado {
  id: string
  cnpj: string
  tipo: string
  faturamento_anual: number | null
  faturamento_confianca: string | null
  funcionarios_crescimento_12m: number | null
  score_faixa: string | null
  limite_potencial: number | null
  receita_mensal_prevista: number | null
  valor_esperado_mensal: number | null
  /** 08 §9: existe ação NOSSA em curso contra ela. É knockout do scorecard. */
  tem_processo_nosso_ativo: boolean | null
}

/** Lê os sacados em páginas: 8 mil linhas × várias laterais não cabem numa consulta só. */
async function paginarSacados(
  aplicar: (linhas: LinhaSacado[]) => Promise<void>,
  tamanho = 500,
  /** Recorte por CNPJ. Ausente = a base inteira, que é o job mensal. */
  cnpjs?: readonly string[],
): Promise<number> {
  let de = 0
  let total = 0
  for (;;) {
    let q = supabaseAdmin
      .from('empresas')
      .select('id, cnpj, tipo, faturamento_anual, faturamento_confianca, funcionarios_crescimento_12m, score_faixa, limite_potencial, receita_mensal_prevista, valor_esperado_mensal, tem_processo_nosso_ativo')
      .in('tipo', SACADOS)
    if (cnpjs && cnpjs.length > 0) q = q.in('cnpj', [...cnpjs])
    const { data, error } = await q
      .order('id', { ascending: true })
      .range(de, de + tamanho - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    await aplicar(data as LinhaSacado[])
    total += data.length
    if (data.length < tamanho) break
    de += tamanho
  }
  return total
}

interface ContextoSinais {
  universo: Map<string, { capital_social: number | null; data_inicio_atividade: string | null; situacao_cadastral: string | null; grupo_id: string | null }>
  metricas: Map<string, { grupo_spes_24m: number | null; obras_ativas: number | null; m2_em_execucao: number | null }>
  protestos: Map<string, { tem_protesto: boolean; valor_total: number | null; consultado_em: string | null }>
  certificados: Map<string, 'ativo' | 'vencido'>
  analises: Map<string, { estagio: string; vigente: boolean; negada_em: string | null }>
}

async function carregarContexto(cnpjs: string[]): Promise<ContextoSinais> {
  const [universo, metricas, protestos, certificados, analises] = await Promise.all([
    supabaseAdmin
      .from('mercado_universo')
      .select('cnpj, capital_social, data_inicio_atividade, situacao_cadastral, grupo_id')
      .in('cnpj', cnpjs),
    supabaseAdmin
      .from('mercado_metricas')
      .select('cnpj, grupo_spes_24m, obras_ativas, m2_em_execucao')
      .in('cnpj', cnpjs),
    supabaseAdmin
      .from('protestos_atual')
      .select('cnpj, tem_protesto, valor_total, consultado_em')
      .in('cnpj', cnpjs),
    supabaseAdmin.from('certificados').select('cnpj, expires_at, status').in('cnpj', cnpjs),
    supabaseAdmin
      .from('analises_credito')
      .select('cnpj, estagio, expira_em, decidida_em, criada_em')
      .in('cnpj', cnpjs)
      .order('criada_em', { ascending: false }),
  ])

  const ctx: ContextoSinais = {
    universo: new Map(),
    metricas: new Map(),
    protestos: new Map(),
    certificados: new Map(),
    analises: new Map(),
  }

  for (const u of universo.data ?? []) ctx.universo.set(u.cnpj, u)
  for (const m of metricas.data ?? []) ctx.metricas.set(m.cnpj, m)
  // `protestos_atual` é view: o compilador tipa cnpj como anulável. Pular a linha sem
  // CNPJ é o certo — ela não tem como ser casada com empresa nenhuma.
  for (const p of protestos.data ?? []) {
    if (!p.cnpj) continue
    ctx.protestos.set(p.cnpj, {
      tem_protesto: !!p.tem_protesto,
      valor_total: p.valor_total,
      consultado_em: p.consultado_em,
    })
  }
  for (const c of certificados.data ?? []) {
    const vencido = c.expires_at !== null && Date.parse(c.expires_at) < Date.now()
    ctx.certificados.set(c.cnpj, vencido ? 'vencido' : 'ativo')
  }
  // A lista vem ordenada por criada_em desc; o primeiro de cada CNPJ é o mais recente.
  for (const a of analises.data ?? []) {
    const negada = a.estagio === 'negada' ? (a.decidida_em ?? a.criada_em) : null
    const anterior = ctx.analises.get(a.cnpj)
    if (!anterior) {
      ctx.analises.set(a.cnpj, {
        estagio: a.estagio,
        vigente:
          ['aprovada', 'aprovada_parcial'].includes(a.estagio) &&
          (a.expira_em === null || Date.parse(a.expira_em) >= Date.now()),
        negada_em: negada,
      })
    } else if (negada && !anterior.negada_em) {
      // Uma negativa anterior ainda conta para o knockout, mesmo que a análise mais
      // recente seja outra: a janela é sobre a NEGATIVA, não sobre a última linha.
      anterior.negada_em = negada
    }
  }

  return ctx
}

function montarSinais(e: LinhaSacado, ctx: ContextoSinais): SinaisScore {
  const u = ctx.universo.get(e.cnpj)
  const m = ctx.metricas.get(e.cnpj)
  const p = ctx.protestos.get(e.cnpj)
  const a = ctx.analises.get(e.cnpj)

  return {
    // `p` ausente = nunca consultado. É o que torna o fator NÃO AVALIÁVEL em vez de
    // "sem protesto" — a distinção que sustenta o scorecard inteiro.
    protesto_consultado: p !== undefined,
    protesto_valor_total: p?.valor_total ?? 0,
    protesto_mais_recente_em: p?.consultado_em ?? null,
    faturamento_estimado: e.faturamento_anual,
    capital_social: u?.capital_social ?? null,
    data_inicio_atividade: u?.data_inicio_atividade ?? null,
    situacao_cadastral: u?.situacao_cadastral ?? null,
    teve_irregularidade: false, // sem histórico de situação na base hoje; fica declarado
    grupo_conhecido: u?.grupo_id !== null && u?.grupo_id !== undefined,
    grupo_spes_24m: m?.grupo_spes_24m ?? null,
    obras_ativas: m?.obras_ativas ?? null,
    m2_em_execucao: m?.m2_em_execucao ?? null,
    funcionarios_crescimento_12m: e.funcionarios_crescimento_12m,
    analise_estagio: a?.estagio ?? null,
    analise_vigente: a?.vigente ?? false,
    analise_negada_em: a?.negada_em ?? null,
    certificado: ctx.certificados.get(e.cnpj) ?? 'nunca',
    /*
     * 08 §9. Lido da COLUNA em `empresas`, mantida por trigger sobre `processos`, e
     * não de um EXISTS por linha: esta função roda para cada sacado da base numa
     * varredura mensal, e uma consulta extra por empresa seria oito mil idas ao banco
     * para responder uma pergunta que quase sempre é "não".
     */
    tem_processo_nosso_ativo: e.tem_processo_nosso_ativo ?? false,
  }
}

interface AccScores {
  avaliados: number
  com_score: number
  dados_insuficientes: number
  mudaram_de_faixa: number
}

interface Regua {
  versao: number
  definicao: DefinicaoScorecard
  params: ParametrosScore
  cfg: Awaited<ReturnType<typeof lerConfigCredito>>
}

/** A régua vigente. `null` quando não há scorecard ativo — e aí nada é pontuado. */
async function lerRegua(): Promise<Regua | null> {
  const { data: versao } = await supabaseAdmin
    .from('scorecard_versoes')
    .select('versao, definicao')
    .eq('ativa', true)
    .maybeSingle()
  if (!versao) return null

  const cfg = await lerConfigCredito()
  return {
    versao: versao.versao,
    definicao: versao.definicao as unknown as DefinicaoScorecard,
    params: {
      corte_concessao: cfg.corte_concessao,
      completude_minima: cfg.completude_minima,
      recencia_protesto_dias: cfg.recencia_protesto_dias,
      knockout_negada_meses: cfg.knockout_negada_meses,
    },
    cfg,
  }
}

/**
 * Pontua um lote de sacados. Extraído para a varredura mensal e o recálculo dirigido
 * usarem exatamente o mesmo caminho — duas implementações seriam dois lugares onde a
 * renormalização e o knockout podem divergir, e a divergência só apareceria num número
 * que ninguém consegue explicar.
 */
async function pontuarLote(linhas: LinhaSacado[], regua: Regua, acc: AccScores): Promise<void> {
  const { versao, definicao, params, cfg } = regua
  const ctx = await carregarContexto(linhas.map((l) => l.cnpj))
  {
    for (const e of linhas) {
      const r = calcularScore(montarSinais(e, ctx), definicao, params)
      acc.avaliados++
      if (r.score === null) acc.dados_insuficientes++
      else acc.com_score++

      const { chance } = chanceDaFaixa(r.faixa, cfg.chance_por_faixa, cfg.chance_sem_score)

      await supabaseAdmin.from('empresa_scores').insert({
        empresa_id: e.id,
        cnpj: e.cnpj,
        score: r.score,
        completude: r.completude,
        faixa: r.faixa,
        knockout: r.knockout,
        breakdown: r.breakdown as unknown as Json,
        scorecard_versao: versao,
      })

      /*
       * O VALOR ESPERADO SAI JUNTO, na mesma escrita.
       *
       * `valor_esperado_mensal` é `receita_mensal_prevista × chance_concessao`, e a chance
       * acabou de mudar aqui. Antes esta função gravava a chance nova e deixava o valor
       * esperado com a chance ANTIGA — a régua de ordenação da base ficava mentindo até o
       * job mensal passar.
       *
       * O job mensal escondia o defeito: ele pontua e SÓ DEPOIS estima o potencial, então
       * a ordem certa acontecia por acidente uma vez por mês. Em todo o resto — decisão de
       * crédito, expiração de análise, enriquecimento de lead, análise proprietária — o
       * score é repontuado sozinho e o valor esperado ficava para trás.
       *
       * Não é preciso refazer a cadeia inteira: a receita prevista NÃO depende do score.
       * Só o último elo depende, e é só ele que se refaz.
       */
      const receita = e.receita_mensal_prevista
      const valorEsperado =
        receita === null || receita === undefined ? null : Number(receita) * chance

      await supabaseAdmin
        .from('empresas')
        .update({
          score_credito: r.score,
          score_completude: r.completude,
          score_faixa: r.faixa,
          chance_concessao: chance,
          valor_esperado_mensal: valorEsperado,
          score_calculado_em: new Date().toISOString(),
        })
        .eq('id', e.id)

      // Evento só na MUDANÇA DE FAIXA, não a cada recálculo. Uma notificação por
      // empresa por rodada seria 8 mil avisos por mês, que é o mesmo que nenhum.
      if (e.score_faixa && e.score_faixa !== r.faixa) {
        acc.mudaram_de_faixa++
        await emitirEvento(e.id, EVENTO_TIPOS.SCORE_RECALCULADO, {
          titulo: 'Faixa de crédito alterada',
          resumo: `Score: ${e.score_faixa} → ${r.faixa}${r.score !== null ? ` (${r.score})` : ''}.`,
          url: `/empresas/${e.id}`,
          cnpj: e.cnpj,
          de: e.score_faixa,
          para: r.faixa,
        })
      }
    }
  }
}

export async function recalcularScoresJob(): Promise<{
  status: 'ok' | 'sem_scorecard'
  avaliados?: number
  com_score?: number
  dados_insuficientes?: number
  mudaram_de_faixa?: number
}> {
  const regua = await lerRegua()
  if (!regua) {
    logger.warn('Nenhuma versão de scorecard ativa.')
    return { status: 'sem_scorecard' }
  }

  const acc: AccScores = { avaliados: 0, com_score: 0, dados_insuficientes: 0, mudaram_de_faixa: 0 }
  await paginarSacados((linhas) => pontuarLote(linhas, regua, acc))

  logger.info(acc, 'Scores recalculados.')
  return { status: 'ok', ...acc }
}

/**
 * Recálculo DIRIGIDO, para depois de uma decisão da seguradora (04d §3.3).
 *
 * Uma decisão muda dois fatores da empresa decidida — "histórico de análises" e, se foi
 * negada, o knockout `negada_recente`. Sem isto, a empresa negada hoje continuaria com a
 * faixa antiga até a virada do mês, e o valor esperado dela seguiria sendo multiplicado
 * por uma chance que a própria seguradora acabou de desmentir.
 *
 * Dirigido, e não a varredura inteira: recalcular 8 mil empresas porque UMA foi decidida
 * é caro o bastante para alguém desligar o gatilho — e um gatilho desligado é o mesmo que
 * não existir.
 */
export async function recalcularScoresDeCnpjs(cnpjs: readonly string[]): Promise<AccScores> {
  const acc: AccScores = { avaliados: 0, com_score: 0, dados_insuficientes: 0, mudaram_de_faixa: 0 }
  const unicos = [...new Set(cnpjs.filter(Boolean))]
  if (unicos.length === 0) return acc

  const regua = await lerRegua()
  if (!regua) {
    logger.warn('Decisão aplicada sem scorecard ativo; nada a repontuar.')
    return acc
  }

  const { data } = await supabaseAdmin
    .from('empresas')
    .select('id, cnpj, tipo, faturamento_anual, faturamento_confianca, funcionarios_crescimento_12m, score_faixa, limite_potencial, receita_mensal_prevista, valor_esperado_mensal, tem_processo_nosso_ativo')
    .in('cnpj', unicos)
    .in('tipo', SACADOS)
  if (!data?.length) return acc

  await pontuarLote(data as LinhaSacado[], regua, acc)
  logger.info({ ...acc, cnpjs: unicos.length }, 'Scores repontuados após decisão.')
  return acc
}

// ─── §2.2 Potencial ─────────────────────────────────────────────────────────

/**
 * O limite potencial e a receita prevista.
 *
 * COM `cnpjs`, recalcula só aqueles. Sem, varre a base — que é o job mensal.
 *
 * O recorte existe porque o limite é CACHE de uma conta sobre o faturamento, e o
 * faturamento muda fora do calendário mensal: uma estimativa nova, uma declaração do
 * cliente, um enriquecimento sob demanda. Sem recalcular, a ficha mostra um limite
 * derivado de um faturamento que não está mais na tela — foi o que se viu na 2MS
 * ENGENHARIA em 22/08/2026, com o limite preso a um faturamento de R$ 49 mi enquanto a
 * ficha exibia R$ 37,6 mi.
 */
export async function estimarPotencialJob(opts: { cnpjs?: readonly string[] } = {}): Promise<{
  status: 'ok' | 'sem_calibracao'
  avaliados?: number
  com_limite?: number
  sem_faturamento?: number
  sem_calibracao?: number
  /** Quantos usaram a taxa da própria empresa em vez da padrão. */
  com_taxa_real?: number
}> {
  const ativa = await versaoAtiva()
  if (!ativa) {
    logger.warn('Sem versão de crédito ativa; rode a calibração antes.')
    return { status: 'sem_calibracao' }
  }

  const cfg = await lerConfigCredito()
  const economia: ParametrosEconomia = {
    taxa_padrao_am: cfg.taxa_padrao_am,
    tac: cfg.tac,
    valor_medio_nf: cfg.valor_medio_nf,
    prazo_medio_dias: cfg.prazo_medio_dias,
    utilizacao_media: cfg.utilizacao_media,
    giro_mensal: cfg.giro_mensal,
  }
  const limite: ParametrosLimite = {
    ratio_limite_manual: cfg.ratio_limite_manual,
    cap_absoluto: cfg.cap_absoluto,
    cap_pct_faturamento: cfg.cap_pct_faturamento,
  }

  const coef = ativa.coef ?? coeficientesVazios()
  const taxas = await taxasConhecidas()
  const acc = { avaliados: 0, com_limite: 0, sem_faturamento: 0, sem_calibracao: 0, com_taxa_real: 0 }

  await paginarSacados(
    async (linhas) => {
    for (const e of linhas) {
      acc.avaliados++

      const { data: score } = await supabaseAdmin
        .from('empresas')
        .select('score_faixa, chance_concessao')
        .eq('id', e.id)
        .maybeSingle()

      const faixa = (score?.score_faixa ?? null) as FaixaScore | null
      const chance =
        score?.chance_concessao !== null && score?.chance_concessao !== undefined
          ? { valor: Number(score.chance_concessao), presumida: faixa === 'dados_insuficientes' || faixa === null }
          : { valor: cfg.chance_sem_score, presumida: true }

      const r = calcularPotencial(
        {
          tipo: e.tipo,
          faturamento_estimado: e.faturamento_anual,
          faturamento_confianca: e.faturamento_confianca,
          taxa_mensal_am: taxas.get(e.cnpj) ?? null,
        },
        coef,
        economia,
        limite,
        chance,
      )

      if (r.motivo === 'sem_faturamento') acc.sem_faturamento++
      if (r.motivo === 'sem_calibracao') acc.sem_calibracao++
      if (r.taxa_real) acc.com_taxa_real++

      // NULL quando não dá para calcular — e null, não zero. Zero ordenaria a empresa
      // como "não vale nada" na régua do Explorador, quando o que se sabe é que não
      // se sabe. A diferença decide a lista de prospecção de alguém.
      await supabaseAdmin
        .from('empresas')
        .update({
          limite_potencial: r.limite_potencial,
          limite_confianca: r.confianca,
          receita_mensal_prevista: r.receita_mensal_prevista,
          receita_taxa_am: r.taxa_am,
          valor_esperado_mensal: r.valor_esperado_mensal,
          credito_calculado_em: new Date().toISOString(),
          credito_versao: ativa.versao,
        })
        .eq('id', e.id)

      if (r.limite_potencial === null) continue
      acc.com_limite++

      // Série: mesma regra de variação mínima do 04c — só grava snapshot quando o
      // número realmente mudou, senão a série vira uma coluna de repetições.
      await gravarSerie(e, 'limite_potencial', r.limite_potencial, cfg.variacao_minima_snapshot)
      // A taxa vai junto com a receita pelo mesmo motivo de `taxa_usada` na nota: sem
      // ela, a receita prevista de ontem é impossível de auditar depois que a taxa muda.
      await gravarSerie(e, 'receita_prevista', r.receita_mensal_prevista ?? 0, cfg.variacao_minima_snapshot, {
        taxa_am: r.taxa_am,
        taxa_real: r.taxa_real,
      })

      if (e.limite_potencial === null && r.limite_potencial !== null) {
        await emitirEvento(e.id, EVENTO_TIPOS.CREDITO_POTENCIAL_ATUALIZADO, {
          titulo: 'Potencial de crédito calculado',
          resumo:
            `Limite potencial R$ ${Math.round(r.limite_potencial).toLocaleString('pt-BR')} · ` +
            `valor esperado R$ ${Math.round(r.valor_esperado_mensal ?? 0).toLocaleString('pt-BR')}/mês ` +
            `(confiança ${r.confianca}).`,
          url: `/empresas/${e.id}`,
          cnpj: e.cnpj,
        })
      }
    }
    },
    500,
    opts.cnpjs,
  )

  logger.info(acc, 'Potencial de crédito estimado.')
  return { status: 'ok', ...acc }
}

/**
 * A taxa mensal de cada CNPJ que já tem análise de crédito — o `monthlyRateD0` do
 * snapshot mais recente, exatamente o número que precifica as notas dessa empresa no
 * funil da Antecipação.
 *
 * Carregado de uma vez: são dezenas de CNPJs contra milhares de sacados avaliados, e
 * uma consulta por linha aqui seria uma ida ao banco para quase sempre não achar nada.
 */
async function taxasConhecidas(): Promise<Map<string, number>> {
  // Paginado: `credito_snapshots` é append-only e o PostgREST corta em mil linhas sem
  // avisar. Sem isto, no dia em que a tabela passar de mil, as taxas mais ANTIGAS
  // sumiriam da leitura em silêncio — e algumas empresas voltariam para a taxa padrão
  // sem nada ter mudado.
  const data = await todasAsPaginas<{ cnpj: string; monthly_rate_d0: number | null }>((de, ate) =>
    supabaseAdmin
      .from('credito_snapshots')
      .select('cnpj, monthly_rate_d0, capturado_em')
      .not('monthly_rate_d0', 'is', null)
      .order('capturado_em', { ascending: false })
      .range(de, ate),
  )

  const taxas = new Map<string, number>()
  // Ordenado do mais recente para o mais antigo: o primeiro de cada CNPJ vence.
  for (const s of data) {
    if (!s.cnpj || taxas.has(s.cnpj)) continue
    const t = Number(s.monthly_rate_d0)
    if (Number.isFinite(t) && t > 0) taxas.set(s.cnpj, t)
  }
  return taxas
}

async function gravarSerie(
  e: LinhaSacado,
  metrica: 'limite_potencial' | 'receita_prevista',
  valor: number,
  variacaoMinima: number,
  detalhes: Record<string, unknown> = {},
): Promise<void> {
  const { data: ultimo } = await supabaseAdmin
    .from('empresa_metricas')
    .select('valor')
    .eq('cnpj', e.cnpj)
    .eq('metrica', metrica)
    .order('capturado_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (ultimo) {
    const anterior = Number(ultimo.valor)
    if (anterior > 0 && Math.abs(valor - anterior) / anterior < variacaoMinima) return
  }

  await supabaseAdmin.from('empresa_metricas').insert({
    empresa_id: e.id,
    cnpj: e.cnpj,
    metrica,
    valor,
    origem: 'modelo',
    confianca: e.faturamento_confianca,
    detalhes: detalhes as Json,
  })
}
