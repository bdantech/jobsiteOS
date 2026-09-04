import { z } from 'zod'
import { FAIXAS_SCORE, type FaixaScore } from './score.js'

/**
 * O MOTOR DE PRECIFICAÇÃO (04o).
 *
 * Quando uma análise é aprovada na esteira, alguém do Crédito precisa dizer por
 * QUANTO essa empresa opera: juros, tarifas, limites e acessórios. Este arquivo é a
 * parte que não depende de tela nem de banco — a matriz versionada, a sugestão que
 * sai dela, a conta da TAC proporcional e o validador.
 *
 * ─── POR QUE O VALIDADOR VIVE AQUI, E NÃO SÓ DO OUTRO LADO ──────────────────
 * As condições publicadas alimentam um `POST /api/backoffice/credit-analyses` da
 * plataforma de produção, validado por Zod lá. Se a checagem existisse só lá, uma
 * condição inválida sairia daqui como "publicada", falharia na entrega, e o analista
 * descobriria pelo log de webhook — horas depois, sem saber qual campo. O validador
 * daqui é o ESPELHO do de lá: falhou, não publica, e a mensagem aparece no formulário.
 *
 * ─── A REGRA QUE O EXEMPLO DELES CONTRARIA ──────────────────────────────────
 * D0 (dinheiro hoje) é o produto CARO; D1 (dinheiro amanhã) é o barato. Então
 * `monthly_rate_d0 > monthly_rate_d1` e `fee_d0 > fee_d1`, sempre. O exemplo do
 * contrato de produção está com os dois invertidos — 04o §3 manda ignorar o exemplo
 * e seguir a regra, e é a regra que está codificada aqui.
 */

// ─── Faixas de faturamento (a dimensão principal) ───────────────────────────

/**
 * O porte, pelo faturamento estimado (04c). Limite SUPERIOR exclusivo; `ate: null`
 * fecha o intervalo aberto à direita — mesma convenção das faixas do scorecard.
 */
export const FAIXAS_FATURAMENTO = [
  { id: 'micro', ate: 5_000_000, label: 'até R$ 5 mi' },
  { id: 'pequena', ate: 20_000_000, label: 'R$ 5 mi a 20 mi' },
  { id: 'media', ate: 100_000_000, label: 'R$ 20 mi a 100 mi' },
  { id: 'grande', ate: 500_000_000, label: 'R$ 100 mi a 500 mi' },
  { id: 'corporate', ate: null, label: 'acima de R$ 500 mi' },
] as const

export type FaixaFaturamento = (typeof FAIXAS_FATURAMENTO)[number]['id']

export const FAIXA_FATURAMENTO_LABELS: Record<FaixaFaturamento, string> = {
  micro: 'até R$ 5 mi',
  pequena: 'R$ 5 mi a 20 mi',
  media: 'R$ 20 mi a 100 mi',
  grande: 'R$ 100 mi a 500 mi',
  corporate: 'acima de R$ 500 mi',
}

/**
 * Faturamento desconhecido cai na faixa MAIS BARATA de porte? Não: cai na `micro`.
 *
 * Quem não tem faturamento estimado é, quase sempre, empresa sem dado nenhum — e
 * tratá-la como grande a colocaria na célula de 1,9% ao mês por ausência de
 * informação. O preço do desconhecido é o preço do pequeno.
 */
export function faixaDeFaturamento(faturamento: number | null | undefined): FaixaFaturamento {
  const v = Number(faturamento)
  if (!Number.isFinite(v) || v <= 0) return 'micro'
  for (const f of FAIXAS_FATURAMENTO) {
    if (f.ate === null || v < f.ate) return f.id
  }
  return 'corporate'
}

/**
 * A matriz tem TRÊS colunas de score, e o scorecard tem quatro faixas.
 * `dados_insuficientes` cai na coluna `improvavel`, nunca na do meio: não saber
 * pontuar uma empresa não é notícia neutra, e precificá-la como média seria dar de
 * graça o benefício da dúvida.
 */
export const COLUNAS_SCORE = ['alta', 'media', 'improvavel'] as const
export type ColunaScore = (typeof COLUNAS_SCORE)[number]

export function colunaDeScore(faixa: FaixaScore | string | null | undefined): ColunaScore {
  return faixa === 'alta' || faixa === 'media' ? faixa : 'improvavel'
}

// ─── A matriz versionada ────────────────────────────────────────────────────

/** O que um ajuste move. Positivo encarece, negativo barateia. */
export interface AjustePrecificacao {
  /** Pontos percentuais somados ao juros mensal D0. */
  juros_pp: number
  /** Proporção somada ao `fee_d0` (0.1 = 10% mais caro). */
  fee_pct: number
  /** Pontos percentuais somados à comissão. */
  comissao_pp: number
}

export interface CelulaMatriz {
  /** Juros mensal D0 sugerido, em % ao mês. O D1 é DERIVADO (§ derivações). */
  monthly_rate_d0: number
  commission_percent: number
  /** TAC cheia do D0, em reais. `fee_d1` e os dois `fee_min` são derivados. */
  fee_d0: number
  /** Sobrescrevem os defaults da config quando presentes. */
  max_invoice_amount?: number | null
  max_due_date_days?: number | null
}

export interface FixosPrecificacao {
  bill_fine_percent: number
  extension_rate_percent: number
  invest_back_limit: number
  invest_back_commission_percent: number
  has_referral: boolean
  fidc_ready: boolean
}

export interface FaixasGlobais {
  juros: {
    d0_min: number
    d0_max: number
    d1_desconto_min: number
    d1_desconto_max: number
  }
  tac: {
    fee_d0_min: number
    fee_d0_max: number
    /** O `fee_min` sugerido como proporção do `fee`. 0.5 = metade. */
    fee_min_d0_pct_do_fee: number
    fee_d1_desconto_pct_min: number
    fee_d1_desconto_pct_max: number
  }
  /** Onde a TAC proporcional para de crescer e atinge o `fee` cheio (§4). */
  limiar_proporcionalidade_tac: number
  comissao: { min: number; max: number }
  max_invoice_amount_default: number
  max_due_date_days_default: number
  validade_meses_default: number
  fixos: FixosPrecificacao
}

export interface AjustesMatriz {
  /** Cobertura vigente da seguradora: o risco é dela, o preço cai. */
  cobertura_atradius: AjustePrecificacao
  /** Protesto na janela de recência do 04j. */
  protesto: AjustePrecificacao
  /** Sacado que paga devagar prende o dinheiro por mais tempo. */
  prazo_medio_alto: { acima_de_dias: number } & AjustePrecificacao
  /** Nota pequena é cara de operar: o custo fixo não cabe no ticket. */
  ticket_medio_baixo: { abaixo_de: number } & AjustePrecificacao
  /** Nota grande dilui o custo fixo. */
  ticket_medio_alto: { acima_de: number } & AjustePrecificacao
}

export interface MatrizPrecificacao {
  faixas: FaixasGlobais
  ajustes: AjustesMatriz
  /** `celulas[faixa de faturamento][coluna de score]`. */
  celulas: Record<FaixaFaturamento, Record<ColunaScore, CelulaMatriz>>
}

/**
 * A SEMENTE (04o §3). Empresa grande com score alto perto do piso (1,9% e R$ 150);
 * empresa pequena com score improvável perto do teto (3,4% e R$ 300).
 *
 * É ponto de partida, não dogma: a tela de Admin → Precificação salva versões novas
 * e a análise guarda a versão com que foi precificada. Este objeto e o seed da
 * migração 0185 são o MESMO conteúdo — quem mexer num mexe no outro.
 */
export const MATRIZ_PADRAO: MatrizPrecificacao = {
  faixas: {
    juros: {
      d0_min: 1.9,
      d0_max: 3.4,
      d1_desconto_min: 0.1,
      d1_desconto_max: 0.6,
    },
    tac: {
      fee_d0_min: 150,
      fee_d0_max: 300,
      fee_min_d0_pct_do_fee: 0.5,
      fee_d1_desconto_pct_min: 0.1,
      fee_d1_desconto_pct_max: 0.3,
    },
    limiar_proporcionalidade_tac: 10_000,
    comissao: { min: 1.0, max: 3.0 },
    max_invoice_amount_default: 1_000_000,
    max_due_date_days_default: 90,
    validade_meses_default: 12,
    fixos: {
      bill_fine_percent: 2.0,
      extension_rate_percent: 12.0,
      invest_back_limit: 0,
      invest_back_commission_percent: 0,
      has_referral: false,
      fidc_ready: true,
    },
  },
  ajustes: {
    cobertura_atradius: { juros_pp: -0.2, fee_pct: -0.1, comissao_pp: -0.2 },
    protesto: { juros_pp: 0.4, fee_pct: 0.15, comissao_pp: 0.2 },
    prazo_medio_alto: {
      acima_de_dias: 90,
      juros_pp: 0.15,
      fee_pct: 0,
      comissao_pp: 0,
    },
    ticket_medio_baixo: {
      abaixo_de: 5_000,
      juros_pp: 0,
      fee_pct: 0.1,
      comissao_pp: 0,
    },
    ticket_medio_alto: {
      acima_de: 100_000,
      juros_pp: -0.1,
      fee_pct: -0.1,
      comissao_pp: 0,
    },
  },
  celulas: {
    micro: {
      alta: { monthly_rate_d0: 2.9, commission_percent: 2.5, fee_d0: 260 },
      media: { monthly_rate_d0: 3.15, commission_percent: 2.8, fee_d0: 280 },
      improvavel: {
        monthly_rate_d0: 3.4,
        commission_percent: 3.0,
        fee_d0: 300,
      },
    },
    pequena: {
      alta: { monthly_rate_d0: 2.6, commission_percent: 2.2, fee_d0: 235 },
      media: { monthly_rate_d0: 2.9, commission_percent: 2.5, fee_d0: 260 },
      improvavel: {
        monthly_rate_d0: 3.2,
        commission_percent: 2.8,
        fee_d0: 290,
      },
    },
    media: {
      alta: { monthly_rate_d0: 2.35, commission_percent: 1.9, fee_d0: 210 },
      media: { monthly_rate_d0: 2.6, commission_percent: 2.2, fee_d0: 235 },
      improvavel: {
        monthly_rate_d0: 3.0,
        commission_percent: 2.6,
        fee_d0: 270,
      },
    },
    grande: {
      alta: { monthly_rate_d0: 2.1, commission_percent: 1.5, fee_d0: 180 },
      media: { monthly_rate_d0: 2.35, commission_percent: 1.8, fee_d0: 205 },
      improvavel: {
        monthly_rate_d0: 2.8,
        commission_percent: 2.3,
        fee_d0: 250,
      },
    },
    corporate: {
      alta: { monthly_rate_d0: 1.9, commission_percent: 1.0, fee_d0: 150 },
      media: { monthly_rate_d0: 2.1, commission_percent: 1.4, fee_d0: 175 },
      improvavel: {
        monthly_rate_d0: 2.6,
        commission_percent: 2.0,
        fee_d0: 230,
      },
    },
  },
}

// ─── §4 A TAC proporcional ──────────────────────────────────────────────────

/**
 * `fee_min` NÃO é piso de segurança — é a TAC efetiva das notas pequenas.
 *
 * A tarifa cresce proporcionalmente ao valor da nota até o limiar (config, R$ 10.000
 * por padrão), onde atinge `fee` e para:
 *
 *     TAC = fee_min + (fee − fee_min) × min(valor_nf / limiar, 1)
 *
 * Com `fee = 300`, `fee_min = 150` e limiar 10.000: NF de R$ 10.000 ou mais paga
 * R$ 300; de R$ 5.000 paga R$ 225; de R$ 1.000 paga R$ 165.
 *
 * Ler isto como piso ("cobre no mínimo 150") produziria R$ 300 na nota de mil reais —
 * 30% do valor dela em tarifa. É a diferença entre uma tabela cara e uma tabela
 * predatória, e é por isso que o cálculo mora num lugar só, com teste.
 */
export function calcularTac(valorNf: number, fee: number, feeMin: number, limiar: number): number {
  if (!Number.isFinite(valorNf) || valorNf <= 0) return 0
  // Limiar zerado ou negativo faria a proporção explodir. Sem limiar, a TAC é cheia.
  const proporcao = limiar > 0 ? Math.min(valorNf / limiar, 1) : 1
  return feeMin + (fee - feeMin) * proporcao
}

/** Os valores de NF que o simulador da tela exibe (§4). */
export const VALORES_SIMULACAO = [1_000, 5_000, 10_000, 50_000] as const

export interface LinhaSimulacaoTac {
  valor_nf: number
  tac_d0: number
  tac_d1: number
  /** Juros do período, em reais. */
  juros_d0: number
  juros_d1: number
  custo_total_d0: number
  custo_total_d1: number
  /** (juros + TAC) ÷ valor, em %. É a leitura que denuncia a regressividade. */
  taxa_efetiva_d0: number
  taxa_efetiva_d1: number
}

export interface EntradaSimulacaoTac {
  monthly_rate_d0: number
  monthly_rate_d1: number
  fee_d0: number
  fee_min_d0: number
  fee_d1: number
  fee_min_d1: number
}

/**
 * A simulação da tela (§4).
 *
 * A TAC é FIXA e o juros é proporcional ao valor, então a taxa efetiva de uma nota de
 * mil reais não se parece com a de cinquenta mil — e uma tabela que parece boa no
 * agregado pode ser cara no ticket pequeno. Mostrar as duas colunas lado a lado é a
 * única forma de o analista ver isso antes de publicar.
 *
 * `prazoDias` padrão 30 porque é aí que "taxa efetiva" e "juros mensal" falam a mesma
 * língua: com 30 dias, a parcela de juros da taxa efetiva É a taxa mensal.
 */
export function simularTac(
  entrada: EntradaSimulacaoTac,
  limiar: number,
  valores: readonly number[] = VALORES_SIMULACAO,
  prazoDias = 30,
): LinhaSimulacaoTac[] {
  const meses = prazoDias / 30
  return valores.map((valor) => {
    const tacD0 = calcularTac(valor, entrada.fee_d0, entrada.fee_min_d0, limiar)
    const tacD1 = calcularTac(valor, entrada.fee_d1, entrada.fee_min_d1, limiar)
    const jurosD0 = (valor * entrada.monthly_rate_d0 * meses) / 100
    const jurosD1 = (valor * entrada.monthly_rate_d1 * meses) / 100
    return {
      valor_nf: valor,
      tac_d0: tacD0,
      tac_d1: tacD1,
      juros_d0: jurosD0,
      juros_d1: jurosD1,
      custo_total_d0: jurosD0 + tacD0,
      custo_total_d1: jurosD1 + tacD1,
      taxa_efetiva_d0: valor > 0 ? ((jurosD0 + tacD0) / valor) * 100 : 0,
      taxa_efetiva_d1: valor > 0 ? ((jurosD1 + tacD1) / valor) * 100 : 0,
    }
  })
}

// ─── §3 O motor de sugestão ─────────────────────────────────────────────────

/** O que a esteira e o dossiê sabem sobre a empresa na hora de precificar. */
export interface ContextoPrecificacao {
  faturamento_estimado: number | null
  faixa_score: FaixaScore | string | null
  /** Cobertura vigente da seguradora (04d/04j). Vira `has_insurance`. */
  cobertura_vigente: boolean
  tem_protesto: boolean | null
  /** Prazo médio das NFs observadas do sacado, em dias. */
  prazo_medio_nf_dias: number | null
  /** Ticket médio das NFs observadas, em reais. */
  ticket_medio_nf: number | null
  /** O limite que a esteira aprovou (04d) ou o recomendado pela análise (04j). */
  limite_aprovado: number | null
  limite_recomendado: number | null
  /** Base do `expires_at`. Injetável para o teste não depender do relógio. */
  hoje?: Date
}

/** Um campo do formulário com a faixa em que a sugestão caiu. */
export interface CondicoesFormulario {
  credit_limit: number
  max_invoice_amount: number
  max_due_date_days: number
  expires_at: string
  monthly_rate_d0: number
  monthly_rate_d1: number
  fee_d0: number
  fee_min_d0: number
  fee_d1: number
  fee_min_d1: number
  commission_percent: number
  extension_rate_percent: number
  bill_fine_percent: number
  invest_back_limit: number
  invest_back_commission_percent: number
  has_insurance: boolean
  has_referral: boolean
  fidc_ready: boolean
}

export interface AjusteAplicado {
  id: string
  label: string
  juros_pp: number
  fee_pct: number
  comissao_pp: number
}

export interface ExplicacaoSugestao {
  faixa_faturamento: FaixaFaturamento
  faturamento_estimado: number | null
  coluna_score: ColunaScore
  faixa_score: string | null
  cobertura_vigente: boolean
  tem_protesto: boolean | null
  prazo_medio_nf_dias: number | null
  ticket_medio_nf: number | null
  /** A célula crua, antes dos ajustes. É o "de onde partiu". */
  celula: CelulaMatriz
  ajustes_aplicados: AjusteAplicado[]
  origem_credit_limit: 'esteira' | 'analise_propria' | 'sem_limite'
}

export interface SugestaoCondicoes {
  condicoes: CondicoesFormulario
  explicacao: ExplicacaoSugestao
}

/** Duas casas nos reais, três nos percentuais — o que as colunas numéricas aceitam. */
const reais = (n: number): number => Math.round(n * 100) / 100
const pct = (n: number): number => Math.round(n * 1000) / 1000

const dentro = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max)

/**
 * Onde `valor` cai dentro de `[min, max]`, de 1 (no piso, o melhor perfil) a 0 (no
 * teto). É esta posição que gradua os descontos do D1: quem paga caro em D0 ganha o
 * desconto menor, quem paga barato ganha o maior.
 */
function posicaoNaFaixa(valor: number, min: number, max: number): number {
  if (!(max > min)) return 0.5
  return dentro((max - valor) / (max - min), 0, 1)
}

/**
 * Deriva o D1 e os dois `fee_min` a partir do D0 e das regras da config (§3).
 *
 * Nenhum dos quatro é escolha de célula: se fossem, a matriz teria vinte e cinco
 * lugares para alguém digitar um D1 maior que o D0 — e o validador viveria recusando
 * a própria sugestão.
 */
export function derivarDoD0(
  monthlyRateD0: number,
  feeD0: number,
  faixas: FaixasGlobais,
): Pick<CondicoesFormulario, 'monthly_rate_d1' | 'fee_d1' | 'fee_min_d0' | 'fee_min_d1'> {
  const posJuros = posicaoNaFaixa(monthlyRateD0, faixas.juros.d0_min, faixas.juros.d0_max)
  const descontoPp =
    faixas.juros.d1_desconto_min +
    posJuros * (faixas.juros.d1_desconto_max - faixas.juros.d1_desconto_min)

  const posTac = posicaoNaFaixa(feeD0, faixas.tac.fee_d0_min, faixas.tac.fee_d0_max)
  const descontoFee =
    faixas.tac.fee_d1_desconto_pct_min +
    posTac * (faixas.tac.fee_d1_desconto_pct_max - faixas.tac.fee_d1_desconto_pct_min)

  const feeD1 = reais(feeD0 * (1 - descontoFee))

  return {
    // O D1 nunca encosta no D0 nem cai a zero: as duas pontas violariam o validador,
    // e a sugestão que não passa na própria validação é pior que nenhuma sugestão.
    monthly_rate_d1: pct(dentro(monthlyRateD0 - descontoPp, 0.001, monthlyRateD0 - 0.001)),
    fee_d1: reais(dentro(feeD1, 0, Math.max(feeD0 - 0.01, 0))),
    fee_min_d0: reais(feeD0 * faixas.tac.fee_min_d0_pct_do_fee),
    fee_min_d1: reais(feeD1 * faixas.tac.fee_min_d0_pct_do_fee),
  }
}

/** Hoje + N meses, em AAAA-MM-DD (fuso local, que é o do analista). */
export function validadeEm(meses: number, hoje = new Date()): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  d.setMonth(d.getMonth() + meses)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * A sugestão (§3). Devolve SEMPRE a explicação junto: um preço sem "de onde saiu"
 * chega ao analista com a autoridade de um dado, e ele vai defendê-lo num comitê.
 */
export function sugerirCondicoes(
  ctx: ContextoPrecificacao,
  matriz: MatrizPrecificacao,
): SugestaoCondicoes {
  const faixaFat = faixaDeFaturamento(ctx.faturamento_estimado)
  const coluna = colunaDeScore(ctx.faixa_score)
  const celula = matriz.celulas[faixaFat][coluna]
  const f = matriz.faixas

  const aplicados: AjusteAplicado[] = []
  const aplicar = (id: string, label: string, a: AjustePrecificacao) => {
    if (a.juros_pp === 0 && a.fee_pct === 0 && a.comissao_pp === 0) return
    aplicados.push({
      id,
      label,
      juros_pp: a.juros_pp,
      fee_pct: a.fee_pct,
      comissao_pp: a.comissao_pp,
    })
  }

  if (ctx.cobertura_vigente) {
    aplicar(
      'cobertura_atradius',
      'Cobertura vigente da seguradora',
      matriz.ajustes.cobertura_atradius,
    )
  }
  if (ctx.tem_protesto === true) {
    aplicar('protesto', 'Protesto na janela de recência', matriz.ajustes.protesto)
  }
  if (
    ctx.prazo_medio_nf_dias !== null &&
    ctx.prazo_medio_nf_dias > matriz.ajustes.prazo_medio_alto.acima_de_dias
  ) {
    aplicar(
      'prazo_medio_alto',
      `Prazo médio das NFs acima de ${matriz.ajustes.prazo_medio_alto.acima_de_dias} dias`,
      matriz.ajustes.prazo_medio_alto,
    )
  }
  if (ctx.ticket_medio_nf !== null) {
    if (ctx.ticket_medio_nf < matriz.ajustes.ticket_medio_baixo.abaixo_de) {
      aplicar('ticket_medio_baixo', 'Ticket médio baixo', matriz.ajustes.ticket_medio_baixo)
    } else if (ctx.ticket_medio_nf > matriz.ajustes.ticket_medio_alto.acima_de) {
      aplicar('ticket_medio_alto', 'Ticket médio alto', matriz.ajustes.ticket_medio_alto)
    }
  }

  const somaJuros = aplicados.reduce((s, a) => s + a.juros_pp, 0)
  const somaFee = aplicados.reduce((s, a) => s + a.fee_pct, 0)
  const somaComissao = aplicados.reduce((s, a) => s + a.comissao_pp, 0)

  // Os ajustes movem DENTRO da faixa global. Sair dela é decisão humana, com
  // justificativa registrada (§3) — nunca efeito colateral de dois ajustes somados.
  const rateD0 = pct(dentro(celula.monthly_rate_d0 + somaJuros, f.juros.d0_min, f.juros.d0_max))
  const feeD0 = reais(dentro(celula.fee_d0 * (1 + somaFee), f.tac.fee_d0_min, f.tac.fee_d0_max))
  const comissao = pct(
    dentro(celula.commission_percent + somaComissao, f.comissao.min, f.comissao.max),
  )

  const derivados = derivarDoD0(rateD0, feeD0, f)

  const origem: ExplicacaoSugestao['origem_credit_limit'] =
    ctx.limite_aprovado && ctx.limite_aprovado > 0
      ? 'esteira'
      : ctx.limite_recomendado && ctx.limite_recomendado > 0
        ? 'analise_propria'
        : 'sem_limite'

  const creditLimit = reais(
    origem === 'esteira'
      ? Number(ctx.limite_aprovado)
      : origem === 'analise_propria'
        ? Number(ctx.limite_recomendado)
        : 0,
  )

  return {
    condicoes: {
      credit_limit: creditLimit,
      max_invoice_amount: celula.max_invoice_amount ?? f.max_invoice_amount_default,
      max_due_date_days: celula.max_due_date_days ?? f.max_due_date_days_default,
      expires_at: validadeEm(f.validade_meses_default, ctx.hoje ?? new Date()),
      monthly_rate_d0: rateD0,
      fee_d0: feeD0,
      commission_percent: comissao,
      ...derivados,
      extension_rate_percent: f.fixos.extension_rate_percent,
      bill_fine_percent: f.fixos.bill_fine_percent,
      invest_back_limit: f.fixos.invest_back_limit,
      invest_back_commission_percent: f.fixos.invest_back_commission_percent,
      // Derivado da decisão da seguradora (§5), não escolhido no formulário.
      has_insurance: ctx.cobertura_vigente,
      has_referral: f.fixos.has_referral,
      fidc_ready: f.fixos.fidc_ready,
    },
    explicacao: {
      faixa_faturamento: faixaFat,
      faturamento_estimado: ctx.faturamento_estimado,
      coluna_score: coluna,
      faixa_score: (ctx.faixa_score as string | null) ?? null,
      cobertura_vigente: ctx.cobertura_vigente,
      tem_protesto: ctx.tem_protesto ?? null,
      prazo_medio_nf_dias: ctx.prazo_medio_nf_dias,
      ticket_medio_nf: ctx.ticket_medio_nf,
      celula,
      ajustes_aplicados: aplicados,
      origem_credit_limit: origem,
    },
  }
}

// ─── §3 O validador (espelho do Zod de produção) ────────────────────────────

export interface ErroCondicao {
  campo: string
  mensagem: string
}

export interface ForaDaFaixa {
  campo: string
  valor: number
  min: number
  max: number
}

export interface ResultadoValidacao {
  ok: boolean
  /** Regras duras. Qualquer uma impede a publicação. */
  erros: ErroCondicao[]
  /** Fora da faixa global: permitido, mas exige justificativa registrada. */
  foras_de_faixa: ForaDaFaixa[]
}

const PERCENTUAIS: readonly (keyof CondicoesFormulario)[] = [
  'monthly_rate_d0',
  'monthly_rate_d1',
  'commission_percent',
  'extension_rate_percent',
  'bill_fine_percent',
  'invest_back_commission_percent',
]

export const RE_DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * As mesmas regras que o Zod deles aplica, mais as três validações cruzadas.
 *
 * Roda no formulário a cada tecla e de novo antes de publicar. As duas chamadas são a
 * mesma função de propósito: uma tela que valida diferente do que publica é uma tela
 * que promete e o servidor desmente.
 */
export function validarCondicoes(
  c: CondicoesFormulario,
  matriz: MatrizPrecificacao,
  hoje = new Date(),
): ResultadoValidacao {
  const erros: ErroCondicao[] = []
  const push = (campo: string, mensagem: string) => erros.push({ campo, mensagem })

  const finito = (campo: keyof CondicoesFormulario): boolean => {
    const v = Number(c[campo])
    if (!Number.isFinite(v)) {
      push(campo, 'Informe um número.')
      return false
    }
    return true
  }

  for (const campo of PERCENTUAIS) {
    if (!finito(campo)) continue
    const v = Number(c[campo])
    if (v < 0 || v >= 100) push(campo, 'Percentual precisa ser maior ou igual a 0 e menor que 100.')
  }

  if (finito('credit_limit') && !(c.credit_limit > 0)) {
    push('credit_limit', 'O limite de crédito precisa ser maior que zero.')
  }

  if (
    finito('max_invoice_amount') &&
    (c.max_invoice_amount < 500 || c.max_invoice_amount > 10_000_000)
  ) {
    push('max_invoice_amount', 'O valor máximo por nota fica entre R$ 500 e R$ 10.000.000.')
  }

  if (finito('max_due_date_days')) {
    if (!Number.isInteger(c.max_due_date_days)) {
      push('max_due_date_days', 'O prazo máximo é um número inteiro de dias.')
    } else if (c.max_due_date_days < 5 || c.max_due_date_days > 365) {
      push('max_due_date_days', 'O prazo máximo fica entre 5 e 365 dias.')
    }
  }

  for (const campo of [
    'fee_d0',
    'fee_min_d0',
    'fee_d1',
    'fee_min_d1',
    'invest_back_limit',
  ] as const) {
    if (finito(campo) && Number(c[campo]) < 0) push(campo, 'Não pode ser negativo.')
  }

  // ── Cruzada 1: D0 é o produto CARO. O exemplo do contrato está invertido. ──
  if (
    Number.isFinite(c.monthly_rate_d0) &&
    Number.isFinite(c.monthly_rate_d1) &&
    !(c.monthly_rate_d0 > c.monthly_rate_d1)
  ) {
    push(
      'monthly_rate_d1',
      'O juros do D0 precisa ser MAIOR que o do D1 — D0 é o produto mais caro.',
    )
  }
  if (Number.isFinite(c.fee_d0) && Number.isFinite(c.fee_d1) && !(c.fee_d0 > c.fee_d1)) {
    push('fee_d1', 'A TAC do D0 precisa ser MAIOR que a do D1.')
  }

  // ── Cruzada 2: o fee_min é a TAC da nota pequena, nunca maior que a cheia. ──
  if (Number.isFinite(c.fee_min_d0) && Number.isFinite(c.fee_d0) && c.fee_min_d0 > c.fee_d0) {
    push('fee_min_d0', 'A TAC mínima do D0 não pode passar da TAC cheia.')
  }
  if (Number.isFinite(c.fee_min_d1) && Number.isFinite(c.fee_d1) && c.fee_min_d1 > c.fee_d1) {
    push('fee_min_d1', 'A TAC mínima do D1 não pode passar da TAC cheia.')
  }

  // ── Cruzada 3: invest back não empresta mais que o limite. ──
  if (
    Number.isFinite(c.invest_back_limit) &&
    Number.isFinite(c.credit_limit) &&
    c.invest_back_limit > c.credit_limit
  ) {
    push('invest_back_limit', 'O limite de invest back não pode passar do limite de crédito.')
  }

  if (!RE_DATA_ISO.test(String(c.expires_at ?? ''))) {
    push('expires_at', 'A validade precisa estar em AAAA-MM-DD.')
  } else {
    const partes = String(c.expires_at).split('-').map(Number)
    const [a, m, d] = [partes[0] ?? 0, partes[1] ?? 0, partes[2] ?? 0]
    const data = new Date(a, m - 1, d)
    const valida = data.getFullYear() === a && data.getMonth() === m - 1 && data.getDate() === d
    if (!valida) {
      push('expires_at', 'Data inexistente no calendário.')
    } else {
      const corte = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
      if (data <= corte) push('expires_at', 'A validade precisa ser uma data futura.')
    }
  }

  const f = matriz.faixas
  const foras: ForaDaFaixa[] = []
  const conferir = (campo: keyof CondicoesFormulario, min: number, max: number) => {
    const v = Number(c[campo])
    if (Number.isFinite(v) && (v < min || v > max)) foras.push({ campo, valor: v, min, max })
  }
  conferir('monthly_rate_d0', f.juros.d0_min, f.juros.d0_max)
  conferir('fee_d0', f.tac.fee_d0_min, f.tac.fee_d0_max)
  conferir('commission_percent', f.comissao.min, f.comissao.max)

  return { ok: erros.length === 0, erros, foras_de_faixa: foras }
}

// ─── §7 O payload de produção ───────────────────────────────────────────────

/**
 * Como a empresa é identificada do lado deles: `companyId` quando já existe cadastro
 * na plataforma, senão `document` + `subjectName`. **Exatamente um dos dois** — mandar
 * os dois é erro no contrato deles.
 */
export interface IdentificacaoProducao {
  onepay_company_id: number | null
  cnpj: string
  razao_social: string | null
}

/**
 * Os nomes de campo são EXATAMENTE os do contrato de produção (camelCase). O time de
 * lá repassa este objeto como está, sem transformação — renomear um campo aqui é
 * quebrar o `POST /api/backoffice/credit-analyses` deles.
 */
export interface PayloadProducao {
  companyId?: number
  document?: string
  subjectName?: string
  role: 'PAYER'
  status: 'APPROVED'
  expiresAt: string
  creditLimit: number
  commissionPercent: number
  extensionRatePercent: number
  billFinePercent: number
  monthlyRateD0: number
  monthlyRateD1: number
  feeD0: number
  feeMinD0: number
  feeD1: number
  feeMinD1: number
  maxInvoiceAmount: number
  maxDueDateDays: number
  hasInsurance: boolean
  hasReferral: boolean
  fidcReady: boolean
  investBackLimit: number
  investBackCommissionPercent: number
}

/**
 * O construtor ÚNICO do `payload_producao` — usado pelo webhook e pelo `GET`, como
 * manda o 04n. Uma segunda montagem divergiria na primeira mudança feita em só uma.
 *
 * `role` é sempre `PAYER` e `status` sempre `APPROVED` (§5): esta esteira é só de
 * sacado, e condição comercial só se publica de análise aprovada.
 */
export function montarPayloadProducao(
  c: CondicoesFormulario,
  ident: IdentificacaoProducao,
): PayloadProducao {
  const identificacao =
    ident.onepay_company_id !== null && ident.onepay_company_id !== undefined
      ? { companyId: Number(ident.onepay_company_id) }
      : { document: ident.cnpj, subjectName: ident.razao_social ?? ident.cnpj }

  return {
    ...identificacao,
    role: 'PAYER',
    status: 'APPROVED',
    expiresAt: c.expires_at,
    creditLimit: Number(c.credit_limit),
    commissionPercent: Number(c.commission_percent),
    extensionRatePercent: Number(c.extension_rate_percent),
    billFinePercent: Number(c.bill_fine_percent),
    monthlyRateD0: Number(c.monthly_rate_d0),
    monthlyRateD1: Number(c.monthly_rate_d1),
    feeD0: Number(c.fee_d0),
    feeMinD0: Number(c.fee_min_d0),
    feeD1: Number(c.fee_d1),
    feeMinD1: Number(c.fee_min_d1),
    maxInvoiceAmount: Number(c.max_invoice_amount),
    maxDueDateDays: Number(c.max_due_date_days),
    hasInsurance: Boolean(c.has_insurance),
    hasReferral: Boolean(c.has_referral),
    fidcReady: Boolean(c.fidc_ready),
    investBackLimit: Number(c.invest_back_limit),
    investBackCommissionPercent: Number(c.invest_back_commission_percent),
  }
}

/**
 * O espelho literal do Zod deles, aplicado ao payload JÁ montado.
 *
 * `validarCondicoes` roda sobre o formulário (snake_case, pt-BR nas mensagens); este
 * roda sobre o que sai no fio. Os dois existem porque protegem coisas diferentes: um
 * evita o analista publicar besteira, o outro evita a besteira sair daqui se algum
 * caminho novo pular o formulário.
 */
export const payloadProducaoSchema = z
  .object({
    companyId: z.number().int().positive().optional(),
    document: z
      .string()
      .regex(/^\d{14}$/)
      .optional(),
    subjectName: z.string().trim().min(1).max(300).optional(),
    role: z.literal('PAYER'),
    status: z.literal('APPROVED'),
    expiresAt: z.string().regex(RE_DATA_ISO),
    creditLimit: z.number().positive(),
    commissionPercent: z.number().min(0).lt(100),
    extensionRatePercent: z.number().min(0).lt(100),
    billFinePercent: z.number().min(0).lt(100),
    monthlyRateD0: z.number().min(0).lt(100),
    monthlyRateD1: z.number().min(0).lt(100),
    feeD0: z.number().min(0),
    feeMinD0: z.number().min(0),
    feeD1: z.number().min(0),
    feeMinD1: z.number().min(0),
    maxInvoiceAmount: z.number().min(500).max(10_000_000),
    maxDueDateDays: z.number().int().min(5).max(365),
    hasInsurance: z.boolean(),
    hasReferral: z.boolean(),
    fidcReady: z.boolean(),
    investBackLimit: z.number().min(0),
    investBackCommissionPercent: z.number().min(0).lt(100),
  })
  .superRefine((p, ctx) => {
    const temCompany = p.companyId !== undefined
    const temDocumento = p.document !== undefined || p.subjectName !== undefined
    if (temCompany && temDocumento) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['companyId'],
        message: 'Mande companyId OU document + subjectName, nunca os dois.',
      })
    }
    if (!temCompany && (p.document === undefined || p.subjectName === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['document'],
        message: 'Sem companyId, document e subjectName são obrigatórios.',
      })
    }
    if (!(p.monthlyRateD0 > p.monthlyRateD1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['monthlyRateD1'],
        message: 'monthlyRateD0 precisa ser maior que monthlyRateD1.',
      })
    }
    if (!(p.feeD0 > p.feeD1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['feeD1'],
        message: 'feeD0 precisa ser maior que feeD1.',
      })
    }
    if (p.feeMinD0 > p.feeD0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['feeMinD0'],
        message: 'feeMinD0 não pode passar de feeD0.',
      })
    }
    if (p.feeMinD1 > p.feeD1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['feeMinD1'],
        message: 'feeMinD1 não pode passar de feeD1.',
      })
    }
    if (p.investBackLimit > p.creditLimit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['investBackLimit'],
        message: 'investBackLimit não pode passar de creditLimit.',
      })
    }
  })

// ─── Rótulos e metadados de campo (tela e documentação) ─────────────────────

export const CAMPO_CONDICAO_LABELS: Record<keyof CondicoesFormulario, string> = {
  credit_limit: 'Limite de crédito',
  max_invoice_amount: 'Valor máximo por nota',
  max_due_date_days: 'Prazo máximo (dias)',
  expires_at: 'Validade',
  monthly_rate_d0: 'Juros mensal D0',
  monthly_rate_d1: 'Juros mensal D1',
  fee_d0: 'TAC D0',
  fee_min_d0: 'TAC mínima D0',
  fee_d1: 'TAC D1',
  fee_min_d1: 'TAC mínima D1',
  commission_percent: 'Comissão',
  extension_rate_percent: 'Prorrogação',
  bill_fine_percent: 'Multa',
  invest_back_limit: 'Limite invest back',
  invest_back_commission_percent: 'Comissão invest back',
  has_insurance: 'Tem cobertura',
  has_referral: 'Tem indicação',
  fidc_ready: 'Pronta para FIDC',
}

export const STATUS_CONDICOES = ['rascunho', 'publicada', 'falha_validacao', 'substituida'] as const
export type StatusCondicoes = (typeof STATUS_CONDICOES)[number]

export const STATUS_CONDICOES_LABELS: Record<StatusCondicoes, string> = {
  rascunho: 'Rascunho',
  publicada: 'Publicada',
  falha_validacao: 'Falha de validação',
  substituida: 'Substituída',
}

/** Só para o typecheck lembrar que as faixas de score da matriz são um subconjunto. */
export const FAIXAS_SCORE_DA_MATRIZ: readonly FaixaScore[] = FAIXAS_SCORE
