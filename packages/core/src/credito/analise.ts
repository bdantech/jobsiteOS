/**
 * Análise de crédito proprietária (04j): a camada que DECIDE.
 *
 * ─── POR QUE ESTE ARQUIVO NÃO CHAMA IA ──────────────────────────────────────
 * A arquitetura do 04j tem três camadas e elas não se misturam: a IA LÊ os documentos
 * (extração) e ESCREVE a narrativa (parecer); a matemática decide. Este arquivo é a
 * matemática. Mesma entrada, mesmo resultado, sempre — e por isso ele é testável linha a
 * linha, reproduzível anos depois pela versão dos parâmetros, e defensável num comitê.
 *
 * Um limite de crédito produzido por um modelo de linguagem é indefensável não porque o
 * modelo erre muito, mas porque quando ele erra ninguém consegue dizer onde.
 *
 * ─── A REGRA QUE GOVERNA TUDO AQUI ──────────────────────────────────────────
 * **Não aplicável nunca é zero.** Um teto que não pode ser calculado sai da conta do
 * mínimo inteiro — não entra como 0, que o tornaria automaticamente vinculante e
 * reprovaria toda empresa nova. É a mesma regra do scorecard (04d), onde fator sem dado
 * sai do numerador E do denominador, e pela mesma razão: ausência de informação não é
 * informação ruim.
 *
 * O mesmo vale para indicador: sem insumo, `valor: null` e `faixa: null`. Nada aqui
 * inventa, estima ou preenche por analogia.
 */

// ─── §4.1 Indicadores ───────────────────────────────────────────────────────

export const INDICADORES = [
  'liquidez_corrente',
  'liquidez_seca',
  'endividamento_geral',
  'divida_liquida_ebitda',
  'margem_ebitda',
  'margem_liquida',
  'roe',
  'giro_ativo',
  'pmr',
  'crescimento_receita',
  'cobertura_juros',
] as const
export type IndicadorId = (typeof INDICADORES)[number]

export const INDICADOR_LABELS: Record<IndicadorId, string> = {
  liquidez_corrente: 'Liquidez corrente',
  liquidez_seca: 'Liquidez seca',
  endividamento_geral: 'Endividamento geral',
  divida_liquida_ebitda: 'Dívida líquida / EBITDA',
  margem_ebitda: 'Margem EBITDA',
  margem_liquida: 'Margem líquida',
  roe: 'ROE',
  giro_ativo: 'Giro do ativo',
  pmr: 'Prazo médio de recebimento',
  crescimento_receita: 'Crescimento de receita (CAGR)',
  cobertura_juros: 'Cobertura de juros',
}

/** Como o número se lê. Muda a formatação na UI, não a conta. */
export const INDICADOR_UNIDADE: Record<IndicadorId, 'x' | 'pct' | 'dias'> = {
  liquidez_corrente: 'x',
  liquidez_seca: 'x',
  endividamento_geral: 'pct',
  divida_liquida_ebitda: 'x',
  margem_ebitda: 'pct',
  margem_liquida: 'pct',
  roe: 'pct',
  giro_ativo: 'x',
  pmr: 'dias',
  crescimento_receita: 'pct',
  cobertura_juros: 'x',
}

export type Semaforo = 'verde' | 'amarelo' | 'vermelho'

/**
 * A faixa de referência de um indicador, parametrizada e versionada.
 *
 * `direcao` existe porque metade dos indicadores é "quanto maior melhor" (liquidez,
 * margem) e a outra metade é o contrário (endividamento, PMR). Sem ela, cada faixa
 * precisaria carregar a comparação em código, e a tela de parâmetros viraria um editor
 * de expressões.
 */
export interface FaixaIndicador {
  direcao: 'maior_melhor' | 'menor_melhor'
  /** Alcançar isto é verde. */
  verde: number
  /** Alcançar isto (mas não o verde) é amarelo. Abaixo/acima disto é vermelho. */
  amarelo: number
}

export interface Indicador {
  id: IndicadorId
  label: string
  unidade: 'x' | 'pct' | 'dias'
  valor: number | null
  faixa: Semaforo | null
  formula: string
  /** Os números que entraram, para a UI mostrar a conta e não só o resultado. */
  insumos: Record<string, number | null>
  /** Preenchido quando `valor` é null — é a metade acionável da resposta. */
  motivo_sem_valor?: string
  /**
   * Preenchido quando o número SAIU, mas não do jeito ideal — hoje só o EBITDA
   * aproximado por EBIT. Um número com ressalva ainda é um número; um número com a
   * ressalva escondida é uma armadilha.
   */
  ressalva?: string
}

// ─── §4.2 Tetos ─────────────────────────────────────────────────────────────

export const TETOS = [
  'capacidade_financeira',
  'capacidade_operacional',
  'concentracao_portfolio',
  'cobertura_seguradora',
  'scorecard',
] as const
export type TetoId = (typeof TETOS)[number]

export const TETO_LABELS: Record<TetoId, string> = {
  capacidade_financeira: 'Capacidade financeira',
  capacidade_operacional: 'Capacidade operacional (NF-e observada)',
  concentracao_portfolio: 'Concentração de portfólio',
  cobertura_seguradora: 'Cobertura da seguradora',
  scorecard: 'Banda do scorecard',
}

export interface Teto {
  id: TetoId
  label: string
  aplicavel: boolean
  /** Sempre null quando `aplicavel` é false. NUNCA zero — ver o cabeçalho do arquivo. */
  valor: number | null
  formula: string
  insumos: Record<string, number | string | null>
  /** Obrigatório quando não aplicável: é o que a UI mostra no lugar do número. */
  motivo_nao_aplicavel?: string
  /** O menor entre os aplicáveis. É ele que vira o limite recomendado. */
  vinculante: boolean
}

// ─── Parâmetros versionados ─────────────────────────────────────────────────

/**
 * Tudo que é número de política, e não de empresa, mora aqui — e é versionado, para que
 * uma análise de dezoito meses atrás continue reproduzível quando a política mudar.
 * A migração 0122 semeia a versão 1 com exatamente este conteúdo.
 */
export interface ParametrosAnalise {
  indicadores: Record<IndicadorId, FaixaIndicador>
  capacidade_financeira: {
    /** % da receita anual comprovada. */
    base_pct: number
    /** Multiplicadores de penalidade, aplicados em cadeia. */
    penalidade_alavancagem: { acima_de: number; fator: number }
    penalidade_liquidez: { abaixo_de: number; fator: number }
  }
  capacidade_operacional: {
    /** Multiplica a média mensal de NF-e observada. */
    fator: number
    /** Meses da janela de observação. */
    janela_meses: number
  }
  concentracao_portfolio: {
    /**
     * PL do fundo. `null` = não configurado → o teto sai NÃO APLICÁVEL e fora do mínimo.
     * Deliberadamente vazio na v1: um número inventado aqui apertaria todo limite da casa.
     */
    pl_fundo: number | null
    pct_max_por_sacado: number
  }
  scorecard: {
    /** Faixa do score → teto em R$. Faixa sem entrada = teto não aplicável. */
    banda_por_faixa: Record<string, number | null>
  }
  cenarios: {
    fator_conservador: number
    fator_agressivo: number
    condicionantes_agressivo: string[]
  }
  knockouts: {
    /** Menor teto abaixo disto → NÃO OPERAR (não vale a pena montar a operação). */
    minimo_operacional: number
    pl_negativo: boolean
    divida_liquida_ebitda_acima_de: number | null
    liquidez_corrente_abaixo_de: number | null
  }
  /** O prompt do parecer é parâmetro, não constante de código: ele muda com a leitura. */
  parecer: { instrucoes_extras: string }
}

export const PARAMETROS_PADRAO: ParametrosAnalise = {
  indicadores: {
    liquidez_corrente: { direcao: 'maior_melhor', verde: 1.3, amarelo: 1.0 },
    liquidez_seca: { direcao: 'maior_melhor', verde: 1.0, amarelo: 0.8 },
    endividamento_geral: { direcao: 'menor_melhor', verde: 0.6, amarelo: 0.75 },
    divida_liquida_ebitda: { direcao: 'menor_melhor', verde: 2, amarelo: 3.5 },
    margem_ebitda: { direcao: 'maior_melhor', verde: 0.1, amarelo: 0.05 },
    margem_liquida: { direcao: 'maior_melhor', verde: 0.05, amarelo: 0.01 },
    roe: { direcao: 'maior_melhor', verde: 0.1, amarelo: 0.03 },
    giro_ativo: { direcao: 'maior_melhor', verde: 0.8, amarelo: 0.4 },
    // Construção recebe por medição: 90 dias é rotina, não sintoma.
    pmr: { direcao: 'menor_melhor', verde: 90, amarelo: 150 },
    crescimento_receita: { direcao: 'maior_melhor', verde: 0.1, amarelo: 0 },
    cobertura_juros: { direcao: 'maior_melhor', verde: 3, amarelo: 1.5 },
  },
  capacidade_financeira: {
    base_pct: 0.1,
    penalidade_alavancagem: { acima_de: 3, fator: 0.6 },
    penalidade_liquidez: { abaixo_de: 1, fator: 0.7 },
  },
  capacidade_operacional: { fator: 1.5, janela_meses: 6 },
  concentracao_portfolio: { pl_fundo: null, pct_max_por_sacado: 0.1 },
  scorecard: {
    banda_por_faixa: {
      alta: 5_000_000,
      media: 2_000_000,
      improvavel: 500_000,
      // Sem score não há banda — e não há banda ZERO. O teto sai da conta.
      dados_insuficientes: null,
    },
  },
  cenarios: {
    fator_conservador: 0.7,
    fator_agressivo: 1.3,
    condicionantes_agressivo: [
      'mediante garantia adicional (aval dos sócios ou cessão fiduciária)',
      'revisão obrigatória em 90 dias',
    ],
  },
  knockouts: {
    minimo_operacional: 100_000,
    pl_negativo: true,
    divida_liquida_ebitda_acima_de: 5,
    liquidez_corrente_abaixo_de: 0.6,
  },
  parecer: { instrucoes_extras: '' },
}

// ─── A entrada do cálculo ───────────────────────────────────────────────────

/** Um exercício contábil já revisado, em números puros. Sem origens, sem IA. */
export interface ExercicioContabil {
  exercicio: number
  receita_bruta: number | null
  receita_liquida: number | null
  cmv: number | null
  lucro_bruto: number | null
  /** Despesas operacionais totais (SG&A). Insumo do EBIT. */
  despesas_operacionais: number | null
  /** Depreciação + amortização, quando o documento as publica. É o "DA" do EBITDA. */
  depreciacao_amortizacao: number | null
  /** Equivalência patrimonial. Fica FORA do EBIT — ver `derivarEbitda`. */
  resultado_equivalencia_patrimonial: number | null
  ebitda: number | null
  resultado_financeiro: number | null
  lucro_liquido: number | null
  ativo_circulante: number | null
  ativo_nao_circulante: number | null
  caixa: number | null
  contas_receber: number | null
  estoques: number | null
  passivo_circulante: number | null
  passivo_nao_circulante: number | null
  emprestimos_curto_prazo: number | null
  emprestimos_longo_prazo: number | null
  fornecedores: number | null
  patrimonio_liquido: number | null
}

export interface ContextoAnalise {
  /** Do mais antigo para o mais recente. O cálculo usa o último; o CAGR usa todos. */
  exercicios: ExercicioContabil[]
  /** É reanálise de quem já opera? Só então o teto operacional existe. */
  opera_na_plataforma: boolean
  /** Média mensal de NF-e na janela. `null` quando não opera. */
  media_mensal_nfe: number | null
  /** Limite vigente da seguradora, quando houver. */
  limite_seguradora: number | null
  /** Faixa do scorecard (04d) e o knockout dele, se houver. */
  faixa_score: string | null
  knockout_score: string | null
}

// ─── Utilitários ────────────────────────────────────────────────────────────

const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v)

/** Divisão que se recusa a mentir: sem numerador, sem denominador ou por zero → null. */
function div(a: number | null, b: number | null): number | null {
  const x = num(a)
  const y = num(b)
  if (x === null || y === null || y === 0) return null
  return x / y
}

function soma(...vs: Array<number | null>): number | null {
  const validos = vs.map(num)
  // Um só ausente já contamina a soma: `AC + ANC` sem o ANC não é o ativo total, é
  // metade dele com cara de inteiro.
  if (validos.some((v) => v === null)) return null
  return validos.reduce<number>((a, b) => a + (b as number), 0)
}

/**
 * Custo e despesa são MAGNITUDES: o sinal delas varia por documento e por como o modelo
 * leu a linha. Em 17/08/2026 a extração de um DRE trouxe `cmv` negativo enquanto o
 * documento o publicava positivo — inofensivo ali porque o CMV não entrava em conta
 * nenhuma, e fatal aqui, onde `lucro_bruto − despesas` inverteria de sinal.
 *
 * A aritmética não pode depender de uma convenção que ninguém garante. Só o
 * `resultado_financeiro` carrega sinal de verdade, porque nele o sinal É a informação
 * (receita financeira líquida vs. despesa financeira líquida).
 */
const magnitude = (v: number | null | undefined): number | null => {
  const n = num(v)
  return n === null ? null : Math.abs(n)
}

export type OrigemEbitda = 'explicito' | 'ebit_mais_da' | 'ebit_proxy'

export interface EbitdaDerivado {
  valor: number | null
  origem: OrigemEbitda | null
  /** Como se chegou nele — vai para `insumos` e para a ressalva do indicador. */
  formula: string
  ressalva?: string
  motivo_sem_valor?: string
}

/**
 * O EBITDA, na melhor forma que os documentos permitirem.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 * O formulário padrão da CAIXA — que é o que a maioria dos sacados manda — tem dezesseis
 * linhas e nenhuma delas é EBITDA, depreciação ou amortização. A extração faz certo em
 * não montar o número (a composição varia, e um EBITDA montado por um modelo não é
 * auditável). Mas deixar três indicadores permanentemente apagados por causa do formato
 * de um formulário é jogar fora informação que o documento TEM.
 *
 * Então a derivação vive aqui, na camada determinística: fórmula fixa, insumos à vista,
 * versionada, testável. A IA continua sem inventar nada — ela extrai o que está escrito,
 * e a matemática deriva o que é derivável.
 *
 * ─── A CASCATA ──────────────────────────────────────────────────────────────
 *   1. EBITDA explícito no documento           → usa, sem ressalva.
 *   2. EBIT + depreciação e amortização        → usa, sem ressalva.
 *   3. EBIT sozinho                            → usa COM RESSALVA de que é proxy.
 *   4. nada                                    → null, com o motivo.
 *
 * O degrau 3 é CONSERVADOR por construção: EBIT ≤ EBITDA sempre, então a alavancagem sai
 * pior e a margem sai menor do que a realidade. Errar para o lado que aperta o crédito é
 * o único erro aceitável numa régua de crédito.
 *
 * ─── A EQUIVALÊNCIA PATRIMONIAL FICA DE FORA ────────────────────────────────
 * Resultado de equivalência é lucro de participação em coligada — não é caixa gerado pela
 * operação, e num grupo de construção com SPEs ele pode ser enorme. Neste mesmo DRE ele
 * era 17% do resultado de 2024 e zero em 2025: incluí-lo tornaria o indicador incomparável
 * entre dois anos da MESMA empresa. Fica registrado nos insumos, fora da conta.
 */
export function derivarEbitda(ex: ExercicioContabil | undefined): EbitdaDerivado {
  if (!ex) {
    return { valor: null, origem: null, formula: '—', motivo_sem_valor: 'Nenhum exercício extraído.' }
  }

  const explicito = num(ex.ebitda)
  if (explicito !== null) {
    return { valor: explicito, origem: 'explicito', formula: 'EBITDA publicado no documento' }
  }

  // O lucro bruto extraído é preferido ao derivado: é uma linha própria do DRE, sem
  // depender da convenção de sinal do custo.
  const lucroBruto =
    num(ex.lucro_bruto) ??
    (() => {
      const rl = num(ex.receita_liquida)
      const c = magnitude(ex.cmv)
      return rl === null || c === null ? null : rl - c
    })()
  const despesas = magnitude(ex.despesas_operacionais)

  if (lucroBruto === null || despesas === null) {
    return {
      valor: null,
      origem: null,
      formula: 'EBITDA publicado, ou (lucro bruto − despesas operacionais) + D&A',
      motivo_sem_valor:
        'O documento não publica EBITDA, e faltam insumos para derivá-lo (lucro bruto e despesas operacionais).',
    }
  }

  const ebit = lucroBruto - despesas
  const da = magnitude(ex.depreciacao_amortizacao)

  if (da !== null) {
    return {
      valor: ebit + da,
      origem: 'ebit_mais_da',
      formula: '(lucro bruto − despesas operacionais) + depreciação e amortização',
    }
  }

  return {
    valor: ebit,
    origem: 'ebit_proxy',
    formula: 'lucro bruto − despesas operacionais (EBIT)',
    ressalva:
      'O documento não publica EBITDA nem depreciação/amortização. O valor usado é o EBIT, ' +
      'que é MENOR ou igual ao EBITDA — a leitura sai conservadora, nunca otimista.',
  }
}

export function classificar(valor: number | null, faixa: FaixaIndicador | undefined): Semaforo | null {
  const v = num(valor)
  if (v === null || !faixa) return null
  if (faixa.direcao === 'maior_melhor') {
    if (v >= faixa.verde) return 'verde'
    if (v >= faixa.amarelo) return 'amarelo'
    return 'vermelho'
  }
  if (v <= faixa.verde) return 'verde'
  if (v <= faixa.amarelo) return 'amarelo'
  return 'vermelho'
}

// ─── §4.1 O cálculo dos indicadores ─────────────────────────────────────────

export function calcularIndicadores(ctx: ContextoAnalise, p: ParametrosAnalise): Indicador[] {
  const ex = ctx.exercicios.at(-1)
  const montar = (
    id: IndicadorId,
    valor: number | null,
    formula: string,
    insumos: Record<string, number | null>,
    motivo = 'Faltam insumos nos documentos enviados.',
    ressalva?: string,
  ): Indicador => ({
    id,
    label: INDICADOR_LABELS[id],
    unidade: INDICADOR_UNIDADE[id],
    valor,
    faixa: classificar(valor, p.indicadores[id]),
    formula,
    insumos,
    ...(valor === null ? { motivo_sem_valor: motivo } : {}),
    ...(valor !== null && ressalva ? { ressalva } : {}),
  })

  if (!ex) {
    return INDICADORES.map((id) =>
      montar(id, null, '—', {}, 'Nenhum exercício contábil foi extraído dos documentos.'),
    )
  }


  // Derivado UMA vez e reusado: se cada indicador refizesse a cascata, dois deles
  // poderiam acabar em degraus diferentes dela — e a tela mostraria duas leituras do
  // mesmo EBITDA na mesma coluna.
  const ebitda = derivarEbitda(ex)

  const ativoTotal = soma(ex.ativo_circulante, ex.ativo_nao_circulante)
  const passivoTotal = soma(ex.passivo_circulante, ex.passivo_nao_circulante)
  const dividaBruta = soma(ex.emprestimos_curto_prazo, ex.emprestimos_longo_prazo)
  const dividaLiquida =
    dividaBruta === null || num(ex.caixa) === null ? null : dividaBruta - (num(ex.caixa) as number)
  // O resultado financeiro entra negativo quando é despesa; a cobertura de juros olha o
  // módulo. Um resultado financeiro POSITIVO significa que não há juros a cobrir — e aí
  // o indicador não se aplica em vez de virar infinito.
  const despesaFinanceira =
    num(ex.resultado_financeiro) === null || (num(ex.resultado_financeiro) as number) >= 0
      ? null
      : Math.abs(num(ex.resultado_financeiro) as number)

  const ativoSeco =
    num(ex.ativo_circulante) === null || num(ex.estoques) === null
      ? null
      : (num(ex.ativo_circulante) as number) - (num(ex.estoques) as number)

  return [
    montar(
      'liquidez_corrente',
      div(ex.ativo_circulante, ex.passivo_circulante),
      'ativo circulante ÷ passivo circulante',
      { ativo_circulante: num(ex.ativo_circulante), passivo_circulante: num(ex.passivo_circulante) },
    ),
    montar(
      'liquidez_seca',
      div(ativoSeco, ex.passivo_circulante),
      '(ativo circulante − estoques) ÷ passivo circulante',
      {
        ativo_circulante: num(ex.ativo_circulante),
        estoques: num(ex.estoques),
        passivo_circulante: num(ex.passivo_circulante),
      },
    ),
    montar('endividamento_geral', div(passivoTotal, ativoTotal), 'passivo total ÷ ativo total', {
      passivo_total: passivoTotal,
      ativo_total: ativoTotal,
    }),
    montar(
      'divida_liquida_ebitda',
      div(dividaLiquida, ebitda.valor),
      `(empréstimos CP + LP − caixa) ÷ EBITDA, onde EBITDA = ${ebitda.formula}`,
      {
        divida_liquida: dividaLiquida,
        ebitda: ebitda.valor,
        despesas_operacionais: magnitude(ex.despesas_operacionais),
        depreciacao_amortizacao: magnitude(ex.depreciacao_amortizacao),
        equivalencia_patrimonial_fora_da_conta: num(ex.resultado_equivalencia_patrimonial),
      },
      ebitda.motivo_sem_valor ?? 'Faltam insumos nos documentos enviados.',
      ebitda.ressalva,
    ),
    montar(
      'margem_ebitda',
      div(ebitda.valor, ex.receita_liquida),
      `EBITDA ÷ receita líquida, onde EBITDA = ${ebitda.formula}`,
      { ebitda: ebitda.valor, receita_liquida: num(ex.receita_liquida) },
      ebitda.motivo_sem_valor ?? 'Faltam insumos nos documentos enviados.',
      ebitda.ressalva,
    ),
    montar('margem_liquida', div(ex.lucro_liquido, ex.receita_liquida), 'lucro líquido ÷ receita líquida', {
      lucro_liquido: num(ex.lucro_liquido),
      receita_liquida: num(ex.receita_liquida),
    }),
    montar('roe', div(ex.lucro_liquido, ex.patrimonio_liquido), 'lucro líquido ÷ patrimônio líquido', {
      lucro_liquido: num(ex.lucro_liquido),
      patrimonio_liquido: num(ex.patrimonio_liquido),
    }),
    montar('giro_ativo', div(ex.receita_liquida, ativoTotal), 'receita líquida ÷ ativo total', {
      receita_liquida: num(ex.receita_liquida),
      ativo_total: ativoTotal,
    }),
    montar(
      'pmr',
      (() => {
        const r = div(ex.contas_receber, ex.receita_bruta)
        return r === null ? null : r * 365
      })(),
      '(contas a receber ÷ receita bruta) × 365',
      { contas_receber: num(ex.contas_receber), receita_bruta: num(ex.receita_bruta) },
    ),
    montar(
      'crescimento_receita',
      cagrReceita(ctx.exercicios),
      'CAGR da receita líquida entre o primeiro e o último exercício disponíveis',
      {
        exercicios: ctx.exercicios.length,
        receita_inicial: num(ctx.exercicios[0]?.receita_liquida ?? null),
        receita_final: num(ex.receita_liquida),
      },
      'É preciso pelo menos dois exercícios com receita líquida para medir crescimento.',
    ),
    montar(
      'cobertura_juros',
      div(ebitda.valor, despesaFinanceira),
      `EBITDA ÷ despesa financeira, onde EBITDA = ${ebitda.formula}`,
      { ebitda: ebitda.valor, despesa_financeira: despesaFinanceira },
      num(ex.resultado_financeiro) !== null && (num(ex.resultado_financeiro) as number) >= 0
        ? 'Resultado financeiro positivo no exercício: não há despesa de juros a cobrir.'
        : (ebitda.motivo_sem_valor ?? 'Faltam insumos nos documentos enviados.'),
      ebitda.ressalva,
    ),
  ]
}

/**
 * CAGR entre o primeiro e o último exercício COM receita líquida.
 *
 * Usa os anos declarados e não a contagem de linhas: exercícios de 2021 e 2024 são três
 * períodos, e tratá-los como dois inflaria o crescimento de uma base que só tem furo.
 */
export function cagrReceita(exercicios: ExercicioContabil[]): number | null {
  const comReceita = exercicios
    .filter((e) => num(e.receita_liquida) !== null && (num(e.receita_liquida) as number) > 0)
    .sort((a, b) => a.exercicio - b.exercicio)
  if (comReceita.length < 2) return null
  const primeiro = comReceita[0] as ExercicioContabil
  const ultimo = comReceita.at(-1) as ExercicioContabil
  const anos = ultimo.exercicio - primeiro.exercicio
  if (anos <= 0) return null
  const razao = (num(ultimo.receita_liquida) as number) / (num(primeiro.receita_liquida) as number)
  return Math.pow(razao, 1 / anos) - 1
}

// ─── §4.2 O cálculo dos tetos ───────────────────────────────────────────────

export function calcularTetos(
  ctx: ContextoAnalise,
  p: ParametrosAnalise,
  indicadores: Indicador[],
): Teto[] {
  const ex = ctx.exercicios.at(-1)
  const valorDe = (id: IndicadorId) => indicadores.find((i) => i.id === id)?.valor ?? null
  const tetos: Teto[] = []

  // ── 1. Capacidade financeira ──────────────────────────────────────────────
  const receita = num(ex?.receita_bruta ?? null) ?? num(ex?.receita_liquida ?? null)
  if (receita === null || receita <= 0) {
    tetos.push({
      id: 'capacidade_financeira',
      label: TETO_LABELS.capacidade_financeira,
      aplicavel: false,
      valor: null,
      formula: `${(p.capacidade_financeira.base_pct * 100).toFixed(1)}% da receita anual comprovada, ajustado por alavancagem e liquidez`,
      insumos: { receita_anual: null },
      motivo_nao_aplicavel: 'Nenhuma receita anual foi comprovada nos documentos enviados.',
      vinculante: false,
    })
  } else {
    const alavancagem = valorDe('divida_liquida_ebitda')
    const liquidez = valorDe('liquidez_corrente')
    const penalAlav =
      alavancagem !== null && alavancagem > p.capacidade_financeira.penalidade_alavancagem.acima_de
        ? p.capacidade_financeira.penalidade_alavancagem.fator
        : 1
    const penalLiq =
      liquidez !== null && liquidez < p.capacidade_financeira.penalidade_liquidez.abaixo_de
        ? p.capacidade_financeira.penalidade_liquidez.fator
        : 1
    tetos.push({
      id: 'capacidade_financeira',
      label: TETO_LABELS.capacidade_financeira,
      aplicavel: true,
      valor: receita * p.capacidade_financeira.base_pct * penalAlav * penalLiq,
      formula: `receita anual × ${(p.capacidade_financeira.base_pct * 100).toFixed(1)}% × penalidade de alavancagem × penalidade de liquidez`,
      insumos: {
        receita_anual: receita,
        base_pct: p.capacidade_financeira.base_pct,
        divida_liquida_ebitda: alavancagem,
        penalidade_alavancagem: penalAlav,
        liquidez_corrente: liquidez,
        penalidade_liquidez: penalLiq,
      },
      vinculante: false,
    })
  }

  // ── 2. Capacidade operacional ─────────────────────────────────────────────
  // O único teto que mede COMPORTAMENTO em vez de declaração. Em análise inicial ele não
  // existe — e "não existe" precisa aparecer escrito na tela, porque um zero silencioso
  // aqui reprovaria toda empresa que ainda não opera, que são exatamente todas as novas.
  if (!ctx.opera_na_plataforma) {
    tetos.push({
      id: 'capacidade_operacional',
      label: TETO_LABELS.capacidade_operacional,
      aplicavel: false,
      valor: null,
      formula: `média mensal de NF-e (${p.capacidade_operacional.janela_meses} meses) × ${p.capacidade_operacional.fator}`,
      insumos: { media_mensal_nfe: null },
      motivo_nao_aplicavel: 'Não aplicável — a empresa ainda não opera na plataforma.',
      vinculante: false,
    })
  } else if (num(ctx.media_mensal_nfe) === null || (num(ctx.media_mensal_nfe) as number) <= 0) {
    tetos.push({
      id: 'capacidade_operacional',
      label: TETO_LABELS.capacidade_operacional,
      aplicavel: false,
      valor: null,
      formula: `média mensal de NF-e (${p.capacidade_operacional.janela_meses} meses) × ${p.capacidade_operacional.fator}`,
      insumos: { media_mensal_nfe: num(ctx.media_mensal_nfe) },
      motivo_nao_aplicavel: `Sem NF-e observada nos últimos ${p.capacidade_operacional.janela_meses} meses.`,
      vinculante: false,
    })
  } else {
    tetos.push({
      id: 'capacidade_operacional',
      label: TETO_LABELS.capacidade_operacional,
      aplicavel: true,
      valor: (num(ctx.media_mensal_nfe) as number) * p.capacidade_operacional.fator,
      formula: `média mensal de NF-e × ${p.capacidade_operacional.fator}`,
      insumos: {
        media_mensal_nfe: num(ctx.media_mensal_nfe),
        fator: p.capacidade_operacional.fator,
        janela_meses: p.capacidade_operacional.janela_meses,
      },
      vinculante: false,
    })
  }

  // ── 3. Concentração de portfólio ──────────────────────────────────────────
  // Protege o FUNDO, não o cliente — e por isso não tem nada a ver com a saúde da
  // empresa analisada. Sem o PL configurado, sai de cena inteiro.
  const pl = num(p.concentracao_portfolio.pl_fundo)
  tetos.push(
    pl === null || pl <= 0
      ? {
          id: 'concentracao_portfolio',
          label: TETO_LABELS.concentracao_portfolio,
          aplicavel: false,
          valor: null,
          formula: `PL do fundo × ${(p.concentracao_portfolio.pct_max_por_sacado * 100).toFixed(1)}%`,
          insumos: { pl_fundo: null },
          motivo_nao_aplicavel:
            'PL do fundo não configurado nos parâmetros — o teto de concentração fica fora do cálculo.',
          vinculante: false,
        }
      : {
          id: 'concentracao_portfolio',
          label: TETO_LABELS.concentracao_portfolio,
          aplicavel: true,
          valor: pl * p.concentracao_portfolio.pct_max_por_sacado,
          formula: `PL do fundo × ${(p.concentracao_portfolio.pct_max_por_sacado * 100).toFixed(1)}% máximo por sacado`,
          insumos: { pl_fundo: pl, pct_max_por_sacado: p.concentracao_portfolio.pct_max_por_sacado },
          vinculante: false,
        },
  )

  // ── 4. Cobertura da seguradora ────────────────────────────────────────────
  const seg = num(ctx.limite_seguradora)
  tetos.push(
    seg === null
      ? {
          id: 'cobertura_seguradora',
          label: TETO_LABELS.cobertura_seguradora,
          aplicavel: false,
          valor: null,
          formula: 'limite vigente da seguradora',
          insumos: { limite_seguradora: null },
          motivo_nao_aplicavel: 'Sem limite vigente da seguradora para este CNPJ.',
          vinculante: false,
        }
      : {
          id: 'cobertura_seguradora',
          label: TETO_LABELS.cobertura_seguradora,
          aplicavel: true,
          valor: seg,
          formula: 'limite vigente da seguradora',
          insumos: { limite_seguradora: seg },
          vinculante: false,
        },
  )

  // ── 5. Banda do scorecard ─────────────────────────────────────────────────
  const banda = ctx.faixa_score ? p.scorecard.banda_por_faixa[ctx.faixa_score] : undefined
  tetos.push(
    banda === null || banda === undefined
      ? {
          id: 'scorecard',
          label: TETO_LABELS.scorecard,
          aplicavel: false,
          valor: null,
          formula: 'banda de limite da faixa de score',
          insumos: { faixa_score: ctx.faixa_score },
          motivo_nao_aplicavel: ctx.faixa_score
            ? `A faixa "${ctx.faixa_score}" não tem banda configurada.`
            : 'Esta empresa ainda não foi pontuada pelo scorecard.',
          vinculante: false,
        }
      : {
          id: 'scorecard',
          label: TETO_LABELS.scorecard,
          aplicavel: true,
          valor: banda,
          formula: `banda da faixa "${ctx.faixa_score}"`,
          insumos: { faixa_score: ctx.faixa_score, banda },
          vinculante: false,
        },
  )

  // O vinculante é o MENOR entre os APLICÁVEIS. Empate marca o primeiro, e a ordem é a
  // desta lista — determinismo importa mais aqui do que qualquer critério de desempate.
  const aplicaveis = tetos.filter((t) => t.aplicavel && t.valor !== null)
  if (aplicaveis.length > 0) {
    const menor = aplicaveis.reduce((a, b) => ((b.valor as number) < (a.valor as number) ? b : a))
    menor.vinculante = true
  }

  return tetos
}

export function menorTeto(tetos: Teto[]): Teto | null {
  return tetos.find((t) => t.vinculante) ?? null
}

// ─── §4.3 Cenários e recomendação ───────────────────────────────────────────

export interface Cenario {
  nome: 'conservador' | 'base' | 'agressivo'
  limite: number
  racional: string
  condicionantes?: string[]
}

export type Recomendacao = 'operar' | 'nao_operar'

export interface ResultadoAnalise {
  indicadores: Indicador[]
  tetos: Teto[]
  cenarios: Cenario[]
  recomendacao: Recomendacao
  limite_recomendado: number | null
  /** Por que NÃO OPERAR, item a item. Vazio quando a recomendação é operar. */
  motivos_nao_operar: string[]
  /** O que faltou para calcular — não impede operar, mas precisa estar visível. */
  lacunas_calculo: string[]
}

/**
 * Os knockouts: as condições em que nenhum limite é grande o bastante para compensar.
 * Sempre com o motivo escrito — uma recusa sem motivo é a mesma coisa que uma recusa
 * arbitrária, do ponto de vista de quem a recebe.
 */
export function avaliarKnockouts(
  ctx: ContextoAnalise,
  p: ParametrosAnalise,
  indicadores: Indicador[],
  vinculante: Teto | null,
): string[] {
  const motivos: string[] = []
  const valorDe = (id: IndicadorId) => indicadores.find((i) => i.id === id)?.valor ?? null

  if (ctx.knockout_score) {
    motivos.push(`Knockout do scorecard: ${ctx.knockout_score}.`)
  }

  const ex = ctx.exercicios.at(-1)
  const pl = num(ex?.patrimonio_liquido ?? null)
  if (p.knockouts.pl_negativo && pl !== null && pl < 0) {
    motivos.push('Patrimônio líquido negativo no último exercício.')
  }

  const alav = valorDe('divida_liquida_ebitda')
  const limiteAlav = p.knockouts.divida_liquida_ebitda_acima_de
  if (limiteAlav !== null && alav !== null && alav > limiteAlav) {
    motivos.push(`Dívida líquida / EBITDA em ${alav.toFixed(1)}x, acima do teto de ${limiteAlav}x.`)
  }

  const liq = valorDe('liquidez_corrente')
  const limiteLiq = p.knockouts.liquidez_corrente_abaixo_de
  if (limiteLiq !== null && liq !== null && liq < limiteLiq) {
    motivos.push(`Liquidez corrente em ${liq.toFixed(2)}, abaixo do mínimo de ${limiteLiq}.`)
  }

  if (vinculante === null) {
    motivos.push(
      'Nenhum dos cinco tetos pôde ser calculado — não há base para recomendar limite algum.',
    )
  } else if ((vinculante.valor as number) < p.knockouts.minimo_operacional) {
    motivos.push(
      `O menor teto (${TETO_LABELS[vinculante.id]}) fica abaixo do mínimo operacional configurado.`,
    )
  }

  return motivos
}

export function calcularAnalise(ctx: ContextoAnalise, p: ParametrosAnalise): ResultadoAnalise {
  const indicadores = calcularIndicadores(ctx, p)
  const tetos = calcularTetos(ctx, p, indicadores)
  const vinculante = menorTeto(tetos)
  const motivos = avaliarKnockouts(ctx, p, indicadores, vinculante)

  const lacunas = [
    ...indicadores.filter((i) => i.valor === null).map((i) => `${i.label}: ${i.motivo_sem_valor}`),
    ...tetos.filter((t) => !t.aplicavel).map((t) => `${t.label}: ${t.motivo_nao_aplicavel}`),
  ]

  if (motivos.length > 0 || vinculante === null) {
    return {
      indicadores,
      tetos,
      cenarios: [],
      recomendacao: 'nao_operar',
      limite_recomendado: null,
      motivos_nao_operar: motivos,
      lacunas_calculo: lacunas,
    }
  }

  const base = vinculante.valor as number
  const cenarios: Cenario[] = [
    {
      nome: 'conservador',
      limite: base * p.cenarios.fator_conservador,
      racional: `Menor teto (${TETO_LABELS[vinculante.id]}) × ${p.cenarios.fator_conservador}. Entrada com margem para a primeira safra de operações mostrar comportamento.`,
    },
    {
      nome: 'base',
      limite: base,
      racional: `O menor dos tetos aplicáveis: ${TETO_LABELS[vinculante.id]} — ${vinculante.formula}.`,
    },
    {
      nome: 'agressivo',
      limite: base * p.cenarios.fator_agressivo,
      racional: `Menor teto × ${p.cenarios.fator_agressivo}. Só faz sentido com as condicionantes abaixo atendidas.`,
      condicionantes: p.cenarios.condicionantes_agressivo,
    },
  ]

  return {
    indicadores,
    tetos,
    cenarios,
    recomendacao: 'operar',
    limite_recomendado: base,
    motivos_nao_operar: [],
    lacunas_calculo: lacunas,
  }
}

// ─── §7 Quadrantes do confronto com a seguradora ────────────────────────────

export const QUADRANTES = ['ambos_aprovam', 'ambos_negam', 'so_nos', 'so_seguradora'] as const
export type Quadrante = (typeof QUADRANTES)[number]

export const QUADRANTE_LABELS: Record<Quadrante, string> = {
  ambos_aprovam: 'Ambos aprovam',
  ambos_negam: 'Ambos negam',
  so_nos: 'Só nós aprovamos',
  so_seguradora: 'Só a seguradora aprova',
}

export const QUADRANTE_LEITURA: Record<Quadrante, string> = {
  ambos_aprovam: 'Caminho livre. O limite sugerido é o MENOR dos dois — a cobertura é o teto real.',
  ambos_negam: 'Não operar. Duas leituras independentes chegaram ao mesmo lugar.',
  so_nos:
    'A decisão que só um FIDC com dado próprio pode tomar: operar sem cobertura, com limite reduzido ou com garantia adicional. Exige motivo.',
  so_seguradora:
    'Alerta de complacência. A seguradora aprovou o que a nossa análise recusa — prosseguir exige motivo escrito.',
}

export function classificarQuadrante(
  nossa: Recomendacao | null,
  atradiusStatus: string | null,
): Quadrante | null {
  if (nossa === null || !atradiusStatus) return null
  const seguradoraAprova = ['aprovada', 'aprovada_parcial'].includes(atradiusStatus)
  if (nossa === 'operar') return seguradoraAprova ? 'ambos_aprovam' : 'so_nos'
  return seguradoraAprova ? 'so_seguradora' : 'ambos_negam'
}

export const DECISOES_FINAIS = [
  'operar_com_cobertura',
  'operar_sem_cobertura',
  'operar_limite_reduzido',
  'nao_operar',
] as const
export type DecisaoFinal = (typeof DECISOES_FINAIS)[number]

export const DECISAO_FINAL_LABELS: Record<DecisaoFinal, string> = {
  operar_com_cobertura: 'Operar com cobertura',
  operar_sem_cobertura: 'Operar sem cobertura',
  operar_limite_reduzido: 'Operar com limite reduzido',
  nao_operar: 'Não operar',
}

/**
 * Quando o motivo é obrigatório: em tudo que não seja o caminho trivial do quadrante.
 *
 * O trivial é só um por quadrante — `ambos_aprovam` → operar com cobertura, `ambos_negam`
 * → não operar. Nos outros dois NÃO existe caminho trivial: qualquer decisão em `so_nos`
 * ou `so_seguradora` é uma divergência entre duas leituras, e divergência sem motivo
 * escrito é o que ninguém consegue auditar seis meses depois.
 */
export function motivoObrigatorio(quadrante: Quadrante | null, decisao: DecisaoFinal): boolean {
  if (quadrante === 'ambos_aprovam') return decisao !== 'operar_com_cobertura'
  if (quadrante === 'ambos_negam') return decisao !== 'nao_operar'
  return true
}

// ─── §3 A extração, do lado de cá ───────────────────────────────────────────

export const TIPOS_DOC_CONTABEIS = [
  'balanco_patrimonial',
  'dre',
  'balancete',
  'dfc',
  'dmpl',
  'notas_explicativas',
  'faturamento_declarado',
  'relacao_faturamento_mensal',
  'contrato_social',
  'certidoes',
  'imposto_renda_pj',
  'sped_ecd',
  'parecer_auditoria',
  'outros',
] as const
export type TipoDocContabil = (typeof TIPOS_DOC_CONTABEIS)[number]

export const TIPO_DOC_LABELS: Record<TipoDocContabil, string> = {
  balanco_patrimonial: 'Balanço patrimonial',
  dre: 'DRE',
  balancete: 'Balancete',
  dfc: 'Demonstração de fluxo de caixa',
  dmpl: 'DMPL',
  notas_explicativas: 'Notas explicativas',
  faturamento_declarado: 'Faturamento declarado',
  relacao_faturamento_mensal: 'Relação de faturamento mensal',
  contrato_social: 'Contrato social',
  certidoes: 'Certidões (CND, FGTS, trabalhista)',
  imposto_renda_pj: 'Imposto de renda PJ',
  sped_ecd: 'SPED ECD',
  parecer_auditoria: 'Parecer de auditoria',
  outros: 'Outros',
}

/** Os que a análise precisa para sair de pé. Sem eles ela roda, mas com lacunas grandes. */
export const DOCS_ESSENCIAIS: TipoDocContabil[] = [
  'balanco_patrimonial',
  'dre',
  'faturamento_declarado',
]

/** Só estes tipos vão ao modelo na extração — certidão e contrato social não têm número. */
export const DOCS_EXTRAIVEIS: TipoDocContabil[] = [
  'balanco_patrimonial',
  'dre',
  'balancete',
  'dfc',
  'dmpl',
  'notas_explicativas',
  'faturamento_declarado',
  'relacao_faturamento_mensal',
  'imposto_renda_pj',
  'sped_ecd',
]

/** Os campos que exigem confirmação humana antes de contarem no cálculo (§3). */
export const CAMPOS_CRITICOS = [
  'receita_bruta',
  'receita_liquida',
  'ebitda',
  'patrimonio_liquido',
  'emprestimos_curto_prazo',
  'emprestimos_longo_prazo',
  'caixa',
] as const
export type CampoCritico = (typeof CAMPOS_CRITICOS)[number]

export interface OrigemCampo {
  documento_id: string
  pagina: number | null
  trecho_curto: string
}

/** Um campo extraído: o número, de onde ele veio, e se um humano já olhou. */
export interface CampoExtraido {
  valor: number | null
  origem: OrigemCampo | null
  revisado?: boolean
  /** Preenchido quando alguém corrigiu — o valor que o modelo tinha lido. */
  valor_original?: number | null
}

export interface BlocoExercicio {
  exercicio: number
  moeda: string
  campos: Partial<Record<keyof Omit<ExercicioContabil, 'exercicio'>, CampoExtraido>>
}

export interface Conflito {
  campo: string
  exercicio: number | null
  valores: Array<{ valor: number; origem: OrigemCampo | null }>
}

export interface DadosExtraidos {
  exercicios: BlocoExercicio[]
  lacunas: string[]
  conflitos: Conflito[]
}

/** Achata a extração revisada nos números puros que o cálculo consome. */
export function achatarExtracao(dados: DadosExtraidos | null | undefined): ExercicioContabil[] {
  if (!dados?.exercicios) return []
  return [...dados.exercicios]
    .sort((a, b) => a.exercicio - b.exercicio)
    .map((b) => {
      const c = b.campos ?? {}
      const v = (k: keyof typeof c) => num(c[k]?.valor ?? null)
      return {
        exercicio: b.exercicio,
        receita_bruta: v('receita_bruta'),
        receita_liquida: v('receita_liquida'),
        cmv: v('cmv'),
        lucro_bruto: v('lucro_bruto'),
        despesas_operacionais: v('despesas_operacionais'),
        depreciacao_amortizacao: v('depreciacao_amortizacao'),
        resultado_equivalencia_patrimonial: v('resultado_equivalencia_patrimonial'),
        ebitda: v('ebitda'),
        resultado_financeiro: v('resultado_financeiro'),
        lucro_liquido: v('lucro_liquido'),
        ativo_circulante: v('ativo_circulante'),
        ativo_nao_circulante: v('ativo_nao_circulante'),
        caixa: v('caixa'),
        contas_receber: v('contas_receber'),
        estoques: v('estoques'),
        passivo_circulante: v('passivo_circulante'),
        passivo_nao_circulante: v('passivo_nao_circulante'),
        emprestimos_curto_prazo: v('emprestimos_curto_prazo'),
        emprestimos_longo_prazo: v('emprestimos_longo_prazo'),
        fornecedores: v('fornecedores'),
        patrimonio_liquido: v('patrimonio_liquido'),
      }
    })
}

/**
 * Quais campos críticos ainda esperam um humano. Vazio = pode calcular.
 *
 * Só conta o campo que TEM valor: um crítico que veio `null` não é uma leitura duvidosa
 * a confirmar, é uma lacuna — e lacuna já aparece em `lacunas[]`. Exigir revisão do que
 * não existe faria a tela pedir confirmação de uma linha em branco.
 */
export function criticosPendentes(dados: DadosExtraidos | null | undefined): Array<{
  exercicio: number
  campo: CampoCritico
}> {
  if (!dados?.exercicios) return []
  const pendentes: Array<{ exercicio: number; campo: CampoCritico }> = []
  for (const bloco of dados.exercicios) {
    for (const campo of CAMPOS_CRITICOS) {
      const c = bloco.campos?.[campo]
      if (c && c.valor !== null && c.valor !== undefined && !c.revisado) {
        pendentes.push({ exercicio: bloco.exercicio, campo })
      }
    }
  }
  return pendentes
}

// ─── Vocabulário do registro ────────────────────────────────────────────────

export const STATUS_ANALISE_PROPRIA = [
  'processando',
  'aguardando_revisao',
  'concluida',
  'falhou',
] as const
export type StatusAnalisePropria = (typeof STATUS_ANALISE_PROPRIA)[number]

export const STATUS_ANALISE_PROPRIA_LABELS: Record<StatusAnalisePropria, string> = {
  processando: 'Processando',
  aguardando_revisao: 'Aguardando revisão',
  concluida: 'Concluída',
  falhou: 'Falhou',
}

export const GATILHOS_ANALISE = ['manual', 'automatico_envio_atradius'] as const
export type GatilhoAnalise = (typeof GATILHOS_ANALISE)[number]
