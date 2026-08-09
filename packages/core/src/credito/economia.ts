/**
 * Limite potencial, receita prevista e valor esperado (04d §2).
 *
 * A cadeia inteira é uma multiplicação:
 *
 *   faturamento estimado → limite → volume mensal → receita → × chance = valor esperado
 *
 * O que faz dela algo utilizável e não um número bonito é uma regra só: **a confiança
 * propaga**. Uma multiplicação não cria informação. Se o faturamento é um chute de
 * confiança baixa, o valor esperado é o mesmo chute com outra unidade — e precisa dizer
 * isso, senão o último elo da conta chega ao vendedor com a autoridade de um dado.
 *
 * A segunda regra: **sem calibração não se estima**. `ratio_limite` sai da carteira real
 * (limite concedido ÷ faturamento declarado dos clientes). Sem cliente declarante não há
 * ratio, e inventar um preencheria a base inteira de limites plausíveis e errados —
 * plausível é exatamente o que ninguém questiona.
 */

import type { FaixaScore } from './score.js'

// ─── Calibração ─────────────────────────────────────────────────────────────

export interface CoeficientesCredito {
  /** Mediana de credit_limit / faturamento_anual_declarado, por tipo, com fallback global. */
  ratio_limite: { global: number | null; porTipo: Record<string, number> }
  /** Mediana de (gross_value_last_2m / 2) / credit_limit. Sai da carteira, não de chute. */
  giro_mensal: number | null
  n_clientes: number
  n_declarantes: number
}

export function coeficientesVazios(): CoeficientesCredito {
  return { ratio_limite: { global: null, porTipo: {} }, giro_mensal: null, n_clientes: 0, n_declarantes: 0 }
}

/**
 * Mediana que descarta zero e negativo — distinta da `mediana` do estimador (04c), que
 * aceita qualquer finito. Aqui todo valor é uma razão entre grandezas monetárias, e um
 * zero no meio da amostra é sempre um dado faltando disfarçado de dado.
 */
export function medianaPositiva(valores: readonly number[]): number | null {
  const v = valores.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b)
  if (v.length === 0) return null
  const meio = Math.floor(v.length / 2)
  return v.length % 2 === 1 ? (v[meio] as number) : (((v[meio - 1] as number) + (v[meio] as number)) / 2)
}

export interface AmostraCliente {
  tipo?: string | null
  credit_limit?: number | null
  faturamento_declarado?: number | null
  /** Bruto dos últimos 2 meses; a calibração divide por 2 para virar mensal. */
  gross_value_last_2m?: number | null
}

/**
 * O `n` mínimo por tipo evita o pior tipo de coeficiente: o que parece calibrado e é o
 * acaso de duas empresas. Abaixo dele o tipo cai no global — e se o global também não
 * tiver amostra, não há ratio nenhum, o que é a resposta correta.
 */
export function calibrarCredito(
  amostras: readonly AmostraCliente[],
  nMinimoPorTipo = 5,
): CoeficientesCredito {
  const comLimite = amostras.filter((a) => Number(a.credit_limit ?? 0) > 0)

  const declarantes = comLimite.filter((a) => Number(a.faturamento_declarado ?? 0) > 0)
  const ratioGlobal = medianaPositiva(
    declarantes.map((a) => Number(a.credit_limit) / Number(a.faturamento_declarado)),
  )

  const porTipo: Record<string, number> = {}
  const tipos = new Set(declarantes.map((a) => a.tipo ?? 'desconhecido'))
  for (const tipo of tipos) {
    const doTipo = declarantes.filter((a) => (a.tipo ?? 'desconhecido') === tipo)
    if (doTipo.length < nMinimoPorTipo) continue
    const m = medianaPositiva(doTipo.map((a) => Number(a.credit_limit) / Number(a.faturamento_declarado)))
    if (m !== null) porTipo[tipo] = m
  }

  // O giro NÃO depende de faturamento declarado — sai de limite e volume, os dois
  // medidos na carteira. É o elo da cadeia que já funciona hoje.
  const giro = medianaPositiva(
    comLimite
      .filter((a) => Number(a.gross_value_last_2m ?? 0) > 0)
      .map((a) => Number(a.gross_value_last_2m) / 2 / Number(a.credit_limit)),
  )

  return {
    ratio_limite: { global: ratioGlobal, porTipo },
    giro_mensal: giro,
    n_clientes: comLimite.length,
    n_declarantes: declarantes.length,
  }
}

// ─── Cálculo do potencial ───────────────────────────────────────────────────

export interface ParametrosEconomia {
  taxa_padrao_am: number
  tac: number
  valor_medio_nf: number
  prazo_medio_dias: number
  /** Override manual; null = usar o calibrado. */
  giro_mensal: number | null
}

export interface ParametrosLimite {
  ratio_limite_manual: number | null
  cap_absoluto: number
  cap_pct_faturamento: number
}

export type ConfiancaCredito = 'alta' | 'media' | 'baixa'

export interface SinaisPotencial {
  tipo?: string | null
  faturamento_estimado?: number | null
  faturamento_confianca?: string | null
  /**
   * A taxa que ESTA empresa paga, em % ao mês — `monthlyRateD0` do snapshot de
   * crédito mais recente, o mesmo número que precifica as notas dela no funil.
   *
   * Sem ela a conta usava a taxa padrão para todo mundo, e a padrão é uma média:
   * quem paga 2,5% aparecia rendendo o que renderia a 1,9%, o que subestima em um
   * terço a receita das empresas de que mais se sabe. Justamente as que estão em
   * qualquer lista de prioridade.
   */
  taxa_mensal_am?: number | null
}

export type MotivoSemPotencial = 'sem_faturamento' | 'sem_calibracao'

export interface ResultadoPotencial {
  limite_potencial: number | null
  volume_mensal: number | null
  receita_financeira: number | null
  receita_tac: number | null
  receita_mensal_prevista: number | null
  valor_esperado_mensal: number | null
  /** A taxa mensal (%) que entrou na conta. Gravada pelo mesmo motivo de `taxa_usada` na nota. */
  taxa_am: number | null
  /** false quando caiu na taxa padrão — a tela marca a previsão como menos específica. */
  taxa_real: boolean
  confianca: ConfiancaCredito | null
  /** Verdadeiro quando a chance veio do default por falta de score. */
  chance_presumida: boolean
  /** Qual cap mordeu. Sem isto, ninguém entende por que duas empresas diferentes deram o mesmo limite. */
  cap_aplicado: 'ratio' | 'absoluto' | 'pct_faturamento' | null
  motivo: MotivoSemPotencial | null
}

function semPotencial(motivo: MotivoSemPotencial): ResultadoPotencial {
  return {
    limite_potencial: null,
    volume_mensal: null,
    receita_financeira: null,
    receita_tac: null,
    receita_mensal_prevista: null,
    valor_esperado_mensal: null,
    taxa_am: null,
    taxa_real: false,
    confianca: null,
    chance_presumida: false,
    cap_aplicado: null,
    motivo,
  }
}

/**
 * A confiança do limite é a do faturamento, sem promoção. Deliberadamente não há caminho
 * que devolva `alta` quando a entrada era `media`: o único jeito de o limite ser mais
 * confiável que a estimativa que o gerou seria alguém ter medido o limite, e aí ele não
 * seria potencial.
 */
function confiancaHerdada(origem: string | null | undefined): ConfiancaCredito {
  if (origem === 'alta') return 'alta'
  if (origem === 'media') return 'media'
  return 'baixa'
}

export function calcularPotencial(
  sinais: SinaisPotencial,
  coef: CoeficientesCredito,
  economia: ParametrosEconomia,
  limite: ParametrosLimite,
  chance: { valor: number; presumida: boolean },
): ResultadoPotencial {
  const faturamento = Number(sinais.faturamento_estimado ?? 0)
  if (!(faturamento > 0)) return semPotencial('sem_faturamento')

  const tipo = sinais.tipo ?? 'desconhecido'
  const ratio =
    limite.ratio_limite_manual ?? coef.ratio_limite.porTipo[tipo] ?? coef.ratio_limite.global
  const giro = economia.giro_mensal ?? coef.giro_mensal

  // Sem ratio OU sem giro a cadeia não fecha. Devolver zero seria pior que devolver
  // nada: zero ordena a base como "não vale nada", e o que se sabe é que não se sabe.
  if (ratio === null || ratio === undefined || giro === null) return semPotencial('sem_calibracao')

  const porRatio = faturamento * ratio
  const porPct = faturamento * limite.cap_pct_faturamento
  const limitePotencial = Math.min(porRatio, limite.cap_absoluto, porPct)

  const cap_aplicado: ResultadoPotencial['cap_aplicado'] =
    limitePotencial === porRatio ? 'ratio' : limitePotencial === limite.cap_absoluto ? 'absoluto' : 'pct_faturamento'

  // A taxa da própria empresa quando a conhecemos; a padrão só como último recurso.
  const taxaReal =
    typeof sinais.taxa_mensal_am === 'number' &&
    Number.isFinite(sinais.taxa_mensal_am) &&
    sinais.taxa_mensal_am > 0
  const taxa = taxaReal ? (sinais.taxa_mensal_am as number) : economia.taxa_padrao_am

  const volumeMensal = limitePotencial * giro
  const receitaFinanceira = volumeMensal * (taxa / 100) * (economia.prazo_medio_dias / 30)
  const receitaTac =
    economia.valor_medio_nf > 0 ? (volumeMensal / economia.valor_medio_nf) * economia.tac : 0
  const receitaMensal = receitaFinanceira + receitaTac

  return {
    limite_potencial: limitePotencial,
    volume_mensal: volumeMensal,
    receita_financeira: receitaFinanceira,
    receita_tac: receitaTac,
    receita_mensal_prevista: receitaMensal,
    valor_esperado_mensal: receitaMensal * chance.valor,
    taxa_am: taxa,
    taxa_real: taxaReal,
    confianca: confiancaHerdada(sinais.faturamento_confianca),
    chance_presumida: chance.presumida,
    cap_aplicado,
    motivo: null,
  }
}

export const MOTIVO_SEM_POTENCIAL_LABELS: Record<MotivoSemPotencial, string> = {
  sem_faturamento:
    'Sem faturamento estimado. O limite sai de uma proporção do faturamento — sem ele não há de que tirar proporção.',
  sem_calibracao:
    'Sem calibração vigente. O ratio limite/faturamento sai dos clientes que declararam faturamento; sem declarante não há régua.',
}

export const CAP_LIMITE_LABELS: Record<NonNullable<ResultadoPotencial['cap_aplicado']>, string> = {
  ratio: 'proporção calibrada na carteira',
  absoluto: 'teto absoluto de sanidade',
  pct_faturamento: '% máximo do faturamento',
}

/** Rótulo da faixa para a linha "valor esperado" — junta score e dinheiro numa frase. */
export function explicarValorEsperado(
  faixa: FaixaScore | null,
  chancePresumida: boolean,
): string {
  if (chancePresumida) return 'chance presumida (sem score) de 50%'
  if (faixa === 'alta') return 'chance alta'
  if (faixa === 'media') return 'chance média'
  if (faixa === 'improvavel') return 'chance improvável'
  return 'chance desconhecida'
}
