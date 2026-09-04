import { formatCnpj, normalizeCnpj } from '../../schemas/cnpj.js'
import {
  CAP_LIMITE_LABELS,
  ESTAGIO_ANALISE_LABELS,
  FAIXA_SCORE_LABELS,
  KNOCKOUT_LABELS,
  MOTIVO_SEM_POTENCIAL_LABELS,
  exClientesSchema,
  potencialEmpresaSchema,
  scoreEmpresaSchema,
  solicitarAnaliseSchema,
  statusCnpjSchema,
  statusEsteiraSchema,
  type EstagioAnalise,
  type ExClientesInput,
  type StatusCnpjInput,
  type FaixaScore,
  type Knockout,
  type PotencialEmpresaInput,
  type ScoreEmpresaInput,
  type ScoreEmpresaInput as _ScoreEmpresaInput,
  type SolicitarAnaliseInput,
  type StatusEsteiraInput,
} from '../../credito/index.js'
import { rodarAnalisePropria, solicitarAnalise } from '../../credito/mutations.js'
import {
  DECISAO_FINAL_LABELS,
  INDICADOR_LABELS,
  QUADRANTE_LABELS,
  QUADRANTE_LEITURA,
  STATUS_ANALISE_PROPRIA_LABELS,
  TETO_LABELS,
  type DecisaoFinal,
  type Indicador,
  type IndicadorId,
  type Quadrante,
  type StatusAnalisePropria,
  type Teto,
  type TetoId,
} from '../../credito/analise.js'
import {
  analisePropriaSchema,
  compararSeguradoraSchema,
  condicoesDoCnpjSchema,
  rodarAnaliseToolSchema,
  type AnalisePropriaInput,
  type CompararSeguradoraInput,
  type CondicoesDoCnpjInput,
  type RodarAnaliseToolInput,
} from '../../credito/schemas.js'
import { calcularTac, VALORES_SIMULACAO } from '../../credito/precificacao.js'
import type { AppModule, ToolContext } from '../types.js'

/**
 * Módulo Crédito (04d): quanto de limite esta empresa sustentaria, qual a chance de a
 * seguradora conceder, e onde o pedido está.
 *
 * As três tools de leitura devolvem SEMPRE a procedência junto do número. Uma estimativa
 * de limite sem "de onde saiu" chega ao vendedor com a autoridade de um dado, e o modelo
 * é justamente quem mais precisa repetir a ressalva — ele é lido em voz alta.
 */

const brl = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

async function potencialEmpresa(input: PotencialEmpresaInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)
  const { data, error } = await ctx.supabase
    .from('empresas')
    // UMA string literal, nunca concatenação: supabase-js infere o tipo do retorno a
    // partir do TEXTO do select, e um `'a,' + 'b'` faz a inferência desabar em
    // GenericStringError — que só aparece no typecheck, longe daqui.
    .select('id, cnpj, razao_social, tipo, faturamento_anual, faturamento_origem, faturamento_confianca, limite_potencial, limite_confianca, receita_mensal_prevista, valor_esperado_mensal, chance_concessao, score_faixa, credito_calculado_em, credito_versao')
    .eq('cnpj', cnpj)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { encontrado: false, cnpj: formatCnpj(cnpj) }

  // Sem limite, o motivo é a resposta — e é mais útil que o número que não existe.
  if (data.limite_potencial === null) {
    return {
      encontrado: true,
      cnpj: formatCnpj(cnpj),
      razao_social: data.razao_social,
      limite_potencial: null,
      motivo:
        data.faturamento_anual === null
          ? MOTIVO_SEM_POTENCIAL_LABELS.sem_faturamento
          : MOTIVO_SEM_POTENCIAL_LABELS.sem_calibracao,
      route: `/empresas/${data.id}`,
    }
  }

  return {
    encontrado: true,
    cnpj: formatCnpj(cnpj),
    razao_social: data.razao_social,
    limite_potencial: brl(data.limite_potencial),
    receita_mensal_prevista: brl(data.receita_mensal_prevista),
    valor_esperado_mensal: brl(data.valor_esperado_mensal),
    chance_concessao: data.chance_concessao,
    faixa_score: data.score_faixa,
    como_foi_calculado:
      `Faturamento ${data.faturamento_origem === 'declarado_cliente' ? 'DECLARADO' : 'estimado'} de ` +
      `${brl(data.faturamento_anual)} × proporção calibrada na carteira → limite; limite × giro médio → ` +
      `volume; volume × taxa + TAC → receita; receita × chance de concessão → valor esperado.`,
    confianca: data.limite_confianca,
    ressalva:
      data.limite_confianca === 'baixa'
        ? 'Confiança BAIXA: o limite herda a confiança do faturamento, e este veio de estimativa fraca.'
        : undefined,
    calculado_em: data.credito_calculado_em,
    versao: data.credito_versao,
    route: `/empresas/${data.id}`,
  }
}

async function scoreEmpresa(input: ScoreEmpresaInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)
  const { data, error } = await ctx.supabase
    .from('empresa_scores')
    .select('score, completude, faixa, knockout, breakdown, scorecard_versao, calculado_em')
    .eq('cnpj', cnpj)
    .order('calculado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) {
    return { encontrado: false, cnpj: formatCnpj(cnpj), aviso: 'Esta empresa ainda não foi pontuada.' }
  }

  type LinhaBreakdown = { label?: string; pontos?: number | null; peso?: number; observado?: string; ressalva?: string }
  const linhas = Array.isArray(data.breakdown) ? (data.breakdown as LinhaBreakdown[]) : []

  return {
    encontrado: true,
    cnpj: formatCnpj(cnpj),
    score: data.score,
    faixa: FAIXA_SCORE_LABELS[data.faixa as FaixaScore] ?? data.faixa,
    completude: `${Math.round(Number(data.completude) * 100)}%`,
    knockout: data.knockout ? (KNOCKOUT_LABELS[data.knockout as Knockout] ?? data.knockout) : null,
    // Fator não avaliável aparece na lista COM a marca, em vez de sumir: o que falta é
    // metade da resposta, e é a metade acionável (dá para ir buscar).
    breakdown: linhas.map((b) => ({
      fator: b.label,
      pontos: b.pontos === null || b.pontos === undefined ? 'não avaliável' : `${b.pontos} de ${b.peso}`,
      observado: b.observado,
      ressalva: b.ressalva,
    })),
    aviso:
      data.score === null
        ? 'Score NÃO exibido: a completude dos dados não alcança o mínimo. Um número calculado sobre poucos fatores parece um score e não é.'
        : undefined,
    scorecard_versao: data.scorecard_versao,
    calculado_em: data.calculado_em,
  }
}

async function statusEsteira(input: StatusEsteiraInput, ctx: ToolContext) {
  let q = ctx.supabase.from('analises_credito').select('estagio, limite_solicitado, limite_aprovado')
  if (input.estagio) q = q.eq('estagio', input.estagio)
  const { data, error } = await q
  if (error) throw new Error(error.message)

  const porEstagio = new Map<string, { qtd: number; solicitado: number; aprovado: number }>()
  for (const a of data ?? []) {
    const atual = porEstagio.get(a.estagio) ?? { qtd: 0, solicitado: 0, aprovado: 0 }
    atual.qtd++
    atual.solicitado += Number(a.limite_solicitado ?? 0)
    atual.aprovado += Number(a.limite_aprovado ?? 0)
    porEstagio.set(a.estagio, atual)
  }

  return {
    total: (data ?? []).length,
    por_estagio: [...porEstagio.entries()].map(([estagio, v]) => ({
      estagio: ESTAGIO_ANALISE_LABELS[estagio as EstagioAnalise] ?? estagio,
      quantidade: v.qtd,
      limite_solicitado: brl(v.solicitado),
      limite_aprovado: brl(v.aprovado),
    })),
    route: '/credito',
  }
}

/**
 * Ex-clientes (04h §6). Devolve SEMPRE o tempo desde a saída junto do limite: um
 * ex-cliente de R$ 2 mi que saiu em 2023 e um de R$ 300 mil que saiu mês passado são
 * leads de temperatura oposta, e o valor sozinho ordenaria os dois ao contrário.
 */
async function exClientes(input: ExClientesInput, ctx: ToolContext) {
  let q = ctx.supabase
    .from('ex_clientes')
    .select('nome, cnpj, ex_cliente_desde, meses_desde, ultimo_limite, consumo_historico, ex_cliente_motivo_label')
    .order('ex_cliente_desde', { ascending: false, nullsFirst: false })
  if (input.meses) {
    const corte = new Date()
    corte.setMonth(corte.getMonth() - input.meses)
    q = q.gte('ex_cliente_desde', corte.toISOString().slice(0, 10))
  }
  const { data, error } = await q.limit(200)
  if (error) throw new Error(error.message)

  const linhas = data ?? []
  return {
    total: linhas.length,
    janela: input.meses ? `últimos ${input.meses} meses` : 'todos',
    limite_somado: brl(linhas.reduce((s, l) => s + Number(l.ultimo_limite ?? 0), 0)),
    ex_clientes: linhas.map((l) => ({
      nome: l.nome,
      cnpj: l.cnpj ? formatCnpj(l.cnpj) : null,
      saiu_em: l.ex_cliente_desde,
      ha_meses: l.meses_desde,
      ultimo_limite: brl(l.ultimo_limite),
      consumo_historico: brl(l.consumo_historico),
      // Nulo é "ninguém classificou", que é diferente de "Motivo desconhecido".
      motivo: l.ex_cliente_motivo_label ?? 'não classificado',
    })),
    route: '/empresas?tab=clientes',
  }
}

/**
 * A situação consolidada de UM CNPJ, que é a pergunta que ninguém consegue responder
 * hoje sem abrir três telas: cliente atual, ex-cliente desde X, análise sem cadastro,
 * ou nunca analisado.
 *
 * A ordem das checagens é a ordem da autoridade: o temperature report decide "cliente
 * atual" e ganha de tudo (04h §3), depois o estágio, depois as análises.
 */
async function statusCnpj(input: StatusCnpjInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)

  const [empresa, cliente, analise] = await Promise.all([
    ctx.supabase
      .from('empresas')
      .select('id, razao_social, estagio, ex_cliente_desde, teve_analise_sem_cadastro')
      .eq('cnpj', cnpj)
      .maybeSingle(),
    ctx.supabase.from('clientes_onepay').select('status, last_anticipation').eq('cnpj', cnpj).maybeSingle(),
    ctx.supabase
      .from('analises_plataforma_atual')
      .select('status, expiration_date, credit_limit, empresa_cadastrada')
      .eq('cnpj', cnpj)
      .maybeSingle(),
  ])

  const e = empresa.data
  const c = cliente.data
  const a = analise.data

  const situacao = c?.status === 'active'
    ? 'cliente_atual'
    : e?.estagio === 'ex_cliente'
      ? 'ex_cliente'
      : a && !a.empresa_cadastrada && a.status === 'approved'
        ? 'analise_sem_cadastro'
        : a
          ? 'analisada'
          : 'nunca_analisada'

  const RESUMO: Record<string, string> = {
    cliente_atual: 'Cliente ativo no temperature report.',
    ex_cliente: `Ex-cliente desde ${e?.ex_cliente_desde ?? '—'}: a última análise aprovada venceu e não foi renovada.`,
    analise_sem_cadastro: 'Tem análise APROVADA na plataforma e NUNCA foi cadastrada — nunca operou.',
    analisada: 'Passou por análise de crédito, mas não está aprovada e vigente.',
    nunca_analisada: 'Nenhuma análise de crédito da plataforma para este CNPJ.',
  }

  return {
    cnpj: formatCnpj(cnpj),
    nome: e?.razao_social ?? null,
    situacao,
    resumo: RESUMO[situacao],
    estagio: e?.estagio ?? null,
    ex_cliente_desde: e?.ex_cliente_desde ?? null,
    teve_analise_sem_cadastro: e?.teve_analise_sem_cadastro ?? false,
    ultima_analise: a
      ? { status: a.status, validade: a.expiration_date, limite: brl(a.credit_limit) }
      : null,
    ultima_antecipacao: c?.last_anticipation ?? null,
    route: e ? `/empresas/${e.id}` : `/mercado/universo/${cnpj}`,
  }
}


// ─── Análise proprietária (04j) ─────────────────────────────────────────────

/**
 * O resultado consolidado. Devolve os TETOS NÃO APLICÁVEIS junto dos aplicáveis, com o
 * motivo: é a metade da resposta que o modelo mais tende a engolir, e é justamente a
 * que explica por que o limite é o que é.
 */
async function analisePropriaDoCnpj(input: AnalisePropriaInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)
  const { data, error } = await ctx.supabase
    .from('analises_proprietarias')
    .select('id, analise_credito_id, status, tipo, recomendacao, limite_recomendado, motivos_nao_operar, indicadores, tetos, cenarios, lacunas_calculo, quadrante, atradius_status, atradius_limite, decisao_final, decisao_limite, decisao_motivo, decidida_em, parecer_markdown, parecer_editado, parametros_versao, criada_em, concluida_em')
    .eq('cnpj', cnpj)
    .order('criada_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) {
    return {
      encontrado: false,
      cnpj: formatCnpj(cnpj),
      aviso: 'Este CNPJ ainda não tem análise proprietária. Ela é rodada sob demanda, a partir dos documentos contábeis anexados na esteira.',
    }
  }

  if (data.status !== 'concluida') {
    return {
      encontrado: true,
      cnpj: formatCnpj(cnpj),
      status: STATUS_ANALISE_PROPRIA_LABELS[data.status as StatusAnalisePropria] ?? data.status,
      aviso:
        data.status === 'aguardando_revisao'
          ? 'A extração está aguardando revisão humana dos campos críticos. Nada foi calculado ainda — não há limite a informar.'
          : 'A análise ainda não está concluída. Não há número a informar.',
      route: `/credito/analises/${data.analise_credito_id}`,
    }
  }

  const indicadores = (Array.isArray(data.indicadores) ? data.indicadores : []) as unknown as Indicador[]
  const tetos = (Array.isArray(data.tetos) ? data.tetos : []) as unknown as Teto[]
  const vinculante = tetos.find((t) => t.vinculante)

  return {
    encontrado: true,
    cnpj: formatCnpj(cnpj),
    status: STATUS_ANALISE_PROPRIA_LABELS.concluida,
    recomendacao: data.recomendacao === 'operar' ? 'OPERAR' : 'NÃO OPERAR',
    limite_recomendado: brl(data.limite_recomendado),
    motivos_nao_operar: data.motivos_nao_operar ?? [],
    teto_vinculante: vinculante
      ? `${TETO_LABELS[vinculante.id as TetoId] ?? vinculante.id} — ${vinculante.formula}`
      : null,
    tetos: tetos.map((t) => ({
      teto: TETO_LABELS[t.id as TetoId] ?? t.id,
      aplicavel: t.aplicavel,
      valor: t.aplicavel ? brl(t.valor) : null,
      // NUNCA some com o não aplicável: "sem cobertura da seguradora" e "cobertura de
      // zero" produzem o mesmo silêncio e significados opostos.
      motivo_nao_aplicavel: t.motivo_nao_aplicavel ?? null,
      vinculante: t.vinculante,
    })),
    indicadores: indicadores
      .filter((i) => i.valor !== null)
      .map((i) => ({
        indicador: INDICADOR_LABELS[i.id as IndicadorId] ?? i.id,
        valor: i.valor,
        unidade: i.unidade,
        semaforo: i.faixa,
      })),
    indicadores_sem_valor: indicadores
      .filter((i) => i.valor === null)
      .map((i) => `${INDICADOR_LABELS[i.id as IndicadorId] ?? i.id}: ${i.motivo_sem_valor ?? 'sem insumo'}`),
    cenarios: data.cenarios ?? [],
    lacunas: data.lacunas_calculo ?? [],
    seguradora: {
      status: data.atradius_status,
      limite: brl(data.atradius_limite),
      quadrante: data.quadrante ? QUADRANTE_LABELS[data.quadrante as Quadrante] : null,
      leitura: data.quadrante ? QUADRANTE_LEITURA[data.quadrante as Quadrante] : null,
    },
    decisao: data.decisao_final
      ? {
          decisao: DECISAO_FINAL_LABELS[data.decisao_final as DecisaoFinal],
          limite: brl(data.decisao_limite),
          motivo: data.decisao_motivo,
          em: data.decidida_em,
        }
      : null,
    parecer: data.parecer_editado ?? data.parecer_markdown,
    ressalva:
      'Os números vêm de um cálculo determinístico versionado (parâmetros v' +
      String(data.parametros_versao) +
      '). O parecer é texto gerado por IA sobre esses números — ele não os altera.',
    route: `/credito/analises/${data.analise_credito_id}`,
  }
}

/** Quadrantes e divergências do período. Serve à pergunta "onde discordamos dela?". */
async function compararSeguradora(input: CompararSeguradoraInput, ctx: ToolContext) {
  const desde = new Date()
  desde.setDate(desde.getDate() - input.dias)

  const { data, error } = await ctx.supabase
    .from('analises_proprietarias')
    .select('cnpj, quadrante, recomendacao, limite_recomendado, atradius_limite, decisao_final, decisao_motivo, analise_credito_id')
    .eq('status', 'concluida')
    .not('quadrante', 'is', null)
    .gte('concluida_em', desde.toISOString())
    .order('concluida_em', { ascending: false })
  if (error) throw new Error(error.message)

  const linhas = data ?? []
  const porQuadrante: Record<string, number> = {}
  for (const l of linhas) {
    const q = l.quadrante as string
    porQuadrante[QUADRANTE_LABELS[q as Quadrante] ?? q] = (porQuadrante[QUADRANTE_LABELS[q as Quadrante] ?? q] ?? 0) + 1
  }

  const divergentes = linhas.filter((l) => l.quadrante === 'so_nos' || l.quadrante === 'so_seguradora')

  return {
    janela_dias: input.dias,
    total: linhas.length,
    por_quadrante: porQuadrante,
    divergencias: divergentes.map((l) => ({
      cnpj: formatCnpj(l.cnpj),
      quadrante: QUADRANTE_LABELS[l.quadrante as Quadrante],
      leitura: QUADRANTE_LEITURA[l.quadrante as Quadrante],
      nosso_limite: brl(l.limite_recomendado),
      limite_seguradora: brl(l.atradius_limite),
      decidida: l.decisao_final ? DECISAO_FINAL_LABELS[l.decisao_final as DecisaoFinal] : 'ainda sem decisão',
      motivo: l.decisao_motivo,
      route: `/credito/analises/${l.analise_credito_id}`,
    })),
    // Sem divergência não há "tudo certo": pode não haver análise proprietária alguma.
    observacao:
      linhas.length === 0
        ? 'Nenhuma análise proprietária foi concluída com resposta da seguradora nesta janela.'
        : undefined,
  }
}

// ─── Condições comerciais (04o) ─────────────────────────────────────────────

/**
 * Por QUANTO este CNPJ opera. Devolve sempre a TAC de quatro tickets junto das
 * taxas, e não só `fee`/`fee_min`.
 *
 * O motivo é o erro que essa dupla de números convida: `fee_min` parece piso de
 * segurança e é a TAC EFETIVA das notas pequenas (04o §4). Um modelo lendo
 * "TAC R$ 300, mínima R$ 150" diria a um cliente que a nota de mil reais custa
 * R$ 300 — quando custa R$ 165. Devolver a conta pronta remove a chance do erro.
 */
async function condicoesDoCnpj(input: CondicoesDoCnpjInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)
  const [condRes, matrizRes] = await Promise.all([
    ctx.supabase
      .from('condicoes_comerciais')
      .select('analise_credito_id, credit_limit, max_invoice_amount, max_due_date_days, expires_at, monthly_rate_d0, monthly_rate_d1, fee_d0, fee_min_d0, fee_d1, fee_min_d1, commission_percent, extension_rate_percent, bill_fine_percent, has_insurance, has_referral, fidc_ready, matriz_versao, publicada_em')
      .eq('cnpj', cnpj)
      .eq('status', 'publicada')
      .maybeSingle(),
    ctx.supabase.from('precificacao_matriz').select('definicao').eq('ativa', true).maybeSingle(),
  ])
  if (condRes.error) throw new Error(condRes.error.message)

  const c = condRes.data
  if (!c) {
    return {
      encontrado: false,
      cnpj: formatCnpj(cnpj),
      aviso:
        'Este CNPJ não tem condições comerciais publicadas. Elas são definidas por alguém do ' +
        'Crédito depois que a análise é aprovada — sem elas, a plataforma de produção não tem ' +
        'preço para operar.',
    }
  }

  const definicao = matrizRes.data?.definicao as
    | { faixas?: { limiar_proporcionalidade_tac?: number } }
    | null
  const limiar = Number(definicao?.faixas?.limiar_proporcionalidade_tac ?? 10_000)
  const n = (v: unknown): number => Number(v ?? 0)

  return {
    encontrado: true,
    cnpj: formatCnpj(cnpj),
    limite_de_credito: brl(c.credit_limit),
    validade: c.expires_at,
    juros_d0: `${n(c.monthly_rate_d0)}% a.m.`,
    juros_d1: `${n(c.monthly_rate_d1)}% a.m.`,
    comissao: `${n(c.commission_percent)}%`,
    tac_por_valor_de_nota: VALORES_SIMULACAO.map((valor) => ({
      nota: brl(valor),
      tac_d0: brl(calcularTac(valor, n(c.fee_d0), n(c.fee_min_d0), limiar)),
      tac_d1: brl(calcularTac(valor, n(c.fee_d1), n(c.fee_min_d1), limiar)),
    })),
    maximo_por_nota: brl(c.max_invoice_amount),
    prazo_maximo_dias: c.max_due_date_days,
    tem_cobertura: c.has_insurance,
    multa: `${n(c.bill_fine_percent)}%`,
    prorrogacao: `${n(c.extension_rate_percent)}%`,
    matriz_versao: c.matriz_versao,
    publicada_em: c.publicada_em,
    ressalva:
      `A TAC cresce com o valor da nota até ${brl(limiar)} e para lá. A "TAC mínima" NÃO é um ` +
      'piso de segurança: é o que a nota pequena paga. Nunca informe a TAC cheia como custo de ' +
      'uma nota abaixo do limiar.',
    route: `/credito/analises/${c.analise_credito_id}`,
  }
}

export const creditoModule: AppModule = {
  id: 'credito',
  name: 'Crédito',
  icon: 'landmark',
  route: '/credito',
  group: 'operacoes',
  tools: [
    {
      id: 'credito.potencial_empresa',
      name: 'Potencial de crédito da empresa',
      description:
        'Limite potencial, receita mensal prevista e valor esperado de um CNPJ, COM a explicação ' +
        'de como cada número saiu do anterior. Quando não há limite, devolve o motivo (falta ' +
        'faturamento estimado, ou falta calibração) — que é a resposta útil. Sempre repita a ' +
        'confiança: ela é herdada do faturamento e não sobe pelo caminho.',
      inputSchema: potencialEmpresaSchema,
      mutates: false,
      execute: (input, ctx) => potencialEmpresa(input as PotencialEmpresaInput, ctx),
    },
    {
      id: 'credito.score_empresa',
      name: 'Score de crédito da empresa',
      description:
        'Score 0–100 de chance de concessão, com completude e breakdown fator a fator (valor ' +
        'observado, pontos e peso). Fator sem dado aparece como "não avaliável" e sai da conta: ' +
        'nunca o trate como zero ao explicar. Score nulo significa dados insuficientes, não score baixo.',
      inputSchema: scoreEmpresaSchema,
      mutates: false,
      execute: (input, ctx) => scoreEmpresa(input as ScoreEmpresaInput, ctx),
    },
    {
      id: 'credito.status_esteira',
      name: 'Status da esteira de crédito',
      description:
        'Contagem e valores (limite solicitado e aprovado) por estágio da esteira de análise. ' +
        'Filtro opcional de estágio. Use para responder "quantas análises estão em análise?".',
      inputSchema: statusEsteiraSchema,
      mutates: false,
      execute: (input, ctx) => statusEsteira(input as StatusEsteiraInput, ctx),
    },
    {
      id: 'clientes.ex_clientes',
      name: 'Ex-clientes',
      description:
        'Quem FOI cliente e saiu: a última análise de crédito aprovada venceu sem renovação. ' +
        'Devolve há quantos meses saiu, o último limite aprovado, o consumo histórico e o motivo ' +
        'classificado. Janela opcional em meses. Não confundir com cliente dormente, que ainda ' +
        'tem limite vigente e só parou de antecipar.',
      inputSchema: exClientesSchema,
      mutates: false,
      execute: (input, ctx) => exClientes(input as ExClientesInput, ctx),
    },
    {
      id: 'clientes.status_cnpj',
      name: 'Situação consolidada de um CNPJ',
      description:
        'Responde, para UM CNPJ: cliente atual, ex-cliente desde X, análise aprovada sem ' +
        'cadastro (nunca operou), analisada sem aprovação vigente, ou nunca analisada. Cruza ' +
        'temperature report, estágio da empresa e análises da plataforma numa resposta só.',
      inputSchema: statusCnpjSchema,
      mutates: false,
      execute: (input, ctx) => statusCnpj(input as StatusCnpjInput, ctx),
    },
    {
      id: 'credito.solicitar_analise',
      name: 'Solicitar análise de crédito',
      description:
        'Cria a solicitação na esteira. NUNCA envia à seguradora — o envio é um clique humano ' +
        'separado, porque resolver o buyer na Atradius pode ser cobrado. Como grava dados, exige ' +
        'confirmação explícita do usuário.',
      inputSchema: solicitarAnaliseSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const a = await solicitarAnalise(ctx.supabase, input as SolicitarAnaliseInput)
        return {
          id: a.id,
          cnpj: formatCnpj(a.cnpj),
          estagio: ESTAGIO_ANALISE_LABELS[a.estagio as EstagioAnalise] ?? a.estagio,
          limite_solicitado: brl(a.limite_solicitado),
          aviso: 'Criada na esteira. O envio à seguradora é uma ação separada, feita por alguém do time de Crédito.',
          route: `/credito/analises/${a.id}`,
        }
      },
    },
    {
      id: 'credito.analise_proprietaria',
      name: 'Análise de crédito proprietária',
      description:
        'O resultado consolidado da NOSSA análise de um CNPJ: recomendação OPERAR/NÃO OPERAR, ' +
        'limite recomendado, os cinco tetos (com "não aplicável" e o motivo, que você NUNCA deve ' +
        'omitir nem tratar como zero), indicadores com semáforo, cenários, o quadrante contra a ' +
        'seguradora e a decisão registrada. Os números são de cálculo determinístico; o parecer é ' +
        'texto de IA sobre eles. Diferente de credito.score_empresa, que estima a CHANCE de a ' +
        'seguradora conceder — aqui é a nossa leitura dos documentos contábeis.',
      inputSchema: analisePropriaSchema,
      mutates: false,
      execute: (input, ctx) => analisePropriaDoCnpj(input as AnalisePropriaInput, ctx),
    },
    {
      id: 'credito.condicoes_comerciais',
      name: 'Condições comerciais do sacado',
      description:
        'Por QUANTO um CNPJ opera: limite, validade, juros D0/D1, comissão, prazo e a TAC já ' +
        'calculada para notas de R$ 1k, 5k, 10k e 50k. D0 (dinheiro hoje) é sempre o produto ' +
        'mais caro que o D1. A "TAC mínima" NÃO é piso de segurança — é a tarifa que a nota ' +
        'pequena paga, e por isso a resposta traz a TAC por ticket em vez de dois números soltos.',
      inputSchema: condicoesDoCnpjSchema,
      mutates: false,
      execute: (input, ctx) => condicoesDoCnpj(input as CondicoesDoCnpjInput, ctx),
    },
    {
      id: 'credito.comparar_seguradora',
      name: 'Confronto com a seguradora',
      description:
        'Quadrantes e divergências do período: onde nós e a Atradius concordamos e onde não. ' +
        '"Só nós aprovamos" é a decisão que só um FIDC com dado próprio pode tomar; ' +
        '"só a seguradora aprova" é alerta de complacência. Ambos exigem motivo escrito.',
      inputSchema: compararSeguradoraSchema,
      mutates: false,
      execute: (input, ctx) => compararSeguradora(input as CompararSeguradoraInput, ctx),
    },
    {
      id: 'credito.rodar_analise',
      name: 'Rodar análise proprietária',
      description:
        'Dispara a análise sobre os documentos contábeis já anexados na esteira daquele CNPJ. ' +
        'NUNCA decide nem aprova: o que ela produz é extração, cálculo e parecer, e a decisão ' +
        'continua sendo de uma pessoa do perfil Crédito. Custa tokens sobre documentos longos, ' +
        'então exige confirmação explícita do usuário.',
      inputSchema: rodarAnaliseToolSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const { cnpj, tipo } = input as RodarAnaliseToolInput
        const normalizado = normalizeCnpj(cnpj)
        const { data: esteira, error } = await ctx.supabase
          .from('analises_credito')
          .select('id, estagio')
          .eq('cnpj', normalizado)
          .order('criada_em', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (error) throw new Error(error.message)
        if (!esteira) {
          return {
            ok: false,
            cnpj: formatCnpj(normalizado),
            motivo:
              'Não há análise na esteira para este CNPJ. Os documentos contábeis ficam pendurados nela — solicite a análise antes.',
          }
        }
        const a = await rodarAnalisePropria(ctx.supabase, {
          analise_credito_id: esteira.id,
          tipo,
          gatilho: 'manual',
        })
        return {
          ok: true,
          id: a.id,
          cnpj: formatCnpj(a.cnpj),
          status: STATUS_ANALISE_PROPRIA_LABELS[a.status as StatusAnalisePropria] ?? a.status,
          aviso:
            'A extração roda em segundo plano e PARA para revisão humana dos campos críticos. ' +
            'Nada é calculado antes de alguém confirmar os números lidos.',
          route: `/credito/analises/${esteira.id}`,
        }
      },
    },
  ],
}

// Reexport para o editor do scorecard não precisar importar de dois lugares.
export { CAP_LIMITE_LABELS }
