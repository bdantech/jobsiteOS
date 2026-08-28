import type { Indice, ParametrosCalculo } from './schemas.js'

/**
 * Motor de cálculo da dívida (08 §6).
 *
 * ── O QUE ELE PRODUZ, E POR QUE A MEMÓRIA IMPORTA MAIS QUE O TOTAL ──────────
 * O total atualizado é um número; a memória de cálculo é a prova. O advogado junta a
 * memória aos autos, e a parte contrária a ataca linha a linha: qual índice, de qual
 * mês a qual mês, quantos meses de juros, sobre qual base a multa incidiu. Um motor que
 * devolvesse só o total obrigaria alguém a refazer a conta no Excel para responder — e
 * essa segunda conta é a que vira divergência.
 *
 * Por isso `memoria` sai linha a linha POR OPERAÇÃO, com o fator aplicado e não só o
 * resultado: um fator de 1,0842 pode ser conferido contra a tabela; um "R$ 108.420,00"
 * não pode.
 *
 * ── OS PARÂMETROS SÃO GRAVADOS JUNTO DO RESULTADO ───────────────────────────
 * `processo_calculos.parametros` guarda a cópia do que foi usado, e nunca uma referência
 * à configuração vigente. A taxa de juros da casa muda; o cálculo de março de 2026
 * continua sendo o de março de 2026. Sem a cópia, reabrir um cálculo antigo mostraria um
 * total que ninguém consegue reproduzir e uma memória que não bate com ele.
 *
 * ── A ORDEM DAS OPERAÇÕES É A DA JURISPRUDÊNCIA CORRENTE, E ESTÁ DECLARADA ──
 *   principal → correção monetária → juros de mora → multa → honorários → custas
 * Correção antes de juros porque juros de mora incidem sobre o valor ATUALIZADO (a
 * correção só recompõe o poder de compra, não é ganho). Multa sobre o principal
 * corrigido, sem os juros. Honorários sobre o subtotal (corrigido + juros + multa) e
 * NUNCA sobre as custas — custas são reembolso, não proveito econômico.
 */

// ─── A tabela de índices ────────────────────────────────────────────────────

/**
 * Variação MENSAL, em percentual (0.45 = 0,45% no mês), por competência `AAAA-MM`.
 * Editável e importável na tela de parâmetros — os índices oficiais saem mensalmente e
 * ninguém vai chamar uma API do IBGE no meio de um cálculo que precisa ser reproduzível.
 */
export type TabelaIndices = Record<string, number>

/**
 * `2026-03` a partir de uma data ISO.
 *
 * `Indice` no nome porque o Comercial já exporta `competenciaDe` (competência de
 * comissão, que é outra coisa) e os dois saem pelo mesmo barril do core.
 */
export function competenciaDeIndice(dataIso: string): string {
  return dataIso.slice(0, 7)
}

/** Todas as competências de `de` até `ate`, inclusive nas duas pontas. */
export function competenciasEntre(de: string, ate: string): string[] {
  const comps: string[] = []
  // `noUncheckedIndexedAccess` está ligado: uma string mal formada devolveria
  // `undefined` no destructuring, e um NaN aqui viraria um laço que só para no teto.
  let ano = Number(de.slice(0, 4))
  let mes = Number(de.slice(5, 7))
  const anoFim = Number(ate.slice(0, 4))
  const mesFim = Number(ate.slice(5, 7))
  if (!Number.isFinite(ano) || !Number.isFinite(mes) || !Number.isFinite(anoFim) || !Number.isFinite(mesFim)) {
    return comps
  }
  // Teto duro: uma data invertida ou um ano digitado errado ("0202") não pode virar um
  // laço de vinte mil iterações dentro de uma server action.
  for (let i = 0; i < 1200; i++) {
    if (ano > anoFim || (ano === anoFim && mes > mesFim)) break
    comps.push(`${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}`)
    mes++
    if (mes > 12) {
      mes = 1
      ano++
    }
  }
  return comps
}

export interface FatorCorrecao {
  fator: number
  /** Competências que não existem na tabela. Aparecem na memória e na tela, nominalmente. */
  faltantes: string[]
  competencias: number
}

/**
 * O fator acumulado entre o vencimento e a data-base, por juros compostos sobre a
 * variação mensal — que é como todo índice de preços acumula.
 *
 * ── MÊS FALTANTE NÃO VIRA ZERO ──────────────────────────────────────────────
 * Uma competência ausente na tabela é tratada como fator 1 (não corrige) E VAI PARA
 * `faltantes`. Tratá-la como zero daria o mesmo número e esconderia o buraco; abortar o
 * cálculo inteiro deixaria o advogado sem nada às vésperas do protocolo. A resposta
 * certa é calcular e DIZER o que faltou — a memória carrega a lista, a tela mostra o
 * aviso, e quem assina decide se protocola assim.
 */
export function fatorCorrecao(
  de: string,
  ate: string,
  tabela: TabelaIndices,
): FatorCorrecao {
  // O mês do vencimento não é corrigido: a correção começa no mês SEGUINTE, porque no
  // mês do vencimento o valor ainda era o valor.
  const comps = competenciasEntre(de, ate).slice(1)
  let fator = 1
  const faltantes: string[] = []

  for (const c of comps) {
    const v = tabela[c]
    if (v === undefined || !Number.isFinite(v)) {
      faltantes.push(c)
      continue
    }
    fator *= 1 + v / 100
  }

  return { fator, faltantes, competencias: comps.length }
}

// ─── Entrada e saída ────────────────────────────────────────────────────────

export interface OperacaoCalculo {
  id: string
  valor_original: number
  vencimento: string
  descricao?: string | null
  access_key?: string | null
  antecipacao_id_externo?: number | null
}

export interface LinhaMemoria {
  operacao_id: string
  descricao: string | null
  vencimento: string
  data_base: string
  dias_em_atraso: number
  meses_em_atraso: number
  principal: number
  indice: Indice
  fator_correcao: number
  correcao: number
  principal_corrigido: number
  juros_pct_am: number
  juros_regime: 'simples' | 'compostos'
  juros: number
  multa_pct: number
  multa: number
  subtotal: number
  /** Competências sem índice na tabela. Vazio é o caso normal. */
  competencias_sem_indice: string[]
}

export interface ResultadoCalculo {
  data_base: string
  principal: number
  correcao: number
  juros: number
  multa: number
  honorarios: number
  custas: number
  total: number
  memoria: LinhaMemoria[]
  /** União dos buracos de todas as linhas, para o aviso único no topo da tela. */
  competencias_sem_indice: string[]
  parametros: ParametrosCalculo
}

const DIA_MS = 86_400_000

function diasEntre(de: string, ate: string): number {
  const a = Date.parse(`${de.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${ate.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, Math.round((b - a) / DIA_MS))
}

/** Duas casas, sempre. Arredondar só no fim de cada etapa evita centavos fantasmas. */
function c(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * O cálculo. `custas` já vem somado pelo chamador (as `processo_custos` do período), e
 * entra POR FORA do percentual de honorários — reembolso não é proveito econômico.
 */
export function calcularDivida(
  operacoes: readonly OperacaoCalculo[],
  parametros: ParametrosCalculo,
  tabela: TabelaIndices,
  dataBase: string,
  custas = 0,
): ResultadoCalculo {
  const memoria: LinhaMemoria[] = []
  const faltantes = new Set<string>()

  let principal = 0
  let correcao = 0
  let juros = 0
  let multa = 0

  for (const op of operacoes) {
    const valor = Number(op.valor_original)
    const dias = diasEntre(op.vencimento, dataBase)
    // Meses de mora contados em 30 dias, como manda a praxe forense — não em meses de
    // calendário. A fração conta: 45 dias de atraso são 1,5 mês de juros, e truncar para
    // 1 subtrai meio mês de mora de toda operação da carteira.
    const meses = dias / 30

    const fc = fatorCorrecao(op.vencimento, dataBase, tabela)
    for (const f of fc.faltantes) faltantes.add(f)

    const corrigido = c(valor * fc.fator)
    const correcaoOp = c(corrigido - valor)

    const jurosOp = c(
      parametros.juros_compostos
        ? corrigido * ((1 + parametros.juros_am / 100) ** meses - 1)
        : corrigido * (parametros.juros_am / 100) * meses,
    )

    const multaOp = c(corrigido * (parametros.multa_pct / 100))

    principal += valor
    correcao += correcaoOp
    juros += jurosOp
    multa += multaOp

    memoria.push({
      operacao_id: op.id,
      descricao: op.descricao ?? null,
      vencimento: op.vencimento,
      data_base: dataBase,
      dias_em_atraso: dias,
      meses_em_atraso: Math.round(meses * 100) / 100,
      principal: c(valor),
      indice: parametros.indice,
      // Seis casas: o fator é o que se confere contra a tabela oficial, e duas casas
      // esconderiam a diferença entre 1,0842 e 1,0849 num principal de sete dígitos.
      fator_correcao: Math.round(fc.fator * 1e6) / 1e6,
      correcao: correcaoOp,
      principal_corrigido: corrigido,
      juros_pct_am: parametros.juros_am,
      juros_regime: parametros.juros_compostos ? 'compostos' : 'simples',
      juros: jurosOp,
      multa_pct: parametros.multa_pct,
      multa: multaOp,
      subtotal: c(corrigido + jurosOp + multaOp),
      competencias_sem_indice: fc.faltantes,
    })
  }

  const subtotal = c(principal + correcao + juros + multa)
  const honorarios = c(subtotal * (parametros.honorarios_pct / 100))
  const custasAplicadas = parametros.incluir_custas ? c(custas) : 0

  return {
    data_base: dataBase,
    principal: c(principal),
    correcao: c(correcao),
    juros: c(juros),
    multa: c(multa),
    honorarios,
    custas: custasAplicadas,
    total: c(subtotal + honorarios + custasAplicadas),
    memoria,
    competencias_sem_indice: [...faltantes].sort(),
    parametros,
  }
}

// ─── Exportação da memória (§6) ─────────────────────────────────────────────

const COLUNAS_CSV = [
  ['descricao', 'Operação'],
  ['vencimento', 'Vencimento'],
  ['principal', 'Principal'],
  ['dias_em_atraso', 'Dias em atraso'],
  ['fator_correcao', 'Fator de correção'],
  ['correcao', 'Correção monetária'],
  ['principal_corrigido', 'Principal corrigido'],
  ['juros', 'Juros de mora'],
  ['multa', 'Multa'],
  ['subtotal', 'Subtotal'],
] as const

/**
 * CSV com `;` e vírgula decimal — o Excel em pt-BR abre assim, e o CSV "correto" com
 * ponto decimal chega ao advogado como uma coluna só de texto.
 */
export function memoriaParaCsv(r: ResultadoCalculo): string {
  const num = (v: number): string => v.toFixed(2).replace('.', ',')
  const linhas: string[] = [COLUNAS_CSV.map(([, rotulo]) => rotulo).join(';')]

  for (const l of r.memoria) {
    linhas.push(
      [
        (l.descricao ?? l.operacao_id).replace(/[;\r\n]/g, ' '),
        l.vencimento,
        num(l.principal),
        String(l.dias_em_atraso),
        l.fator_correcao.toFixed(6).replace('.', ','),
        num(l.correcao),
        num(l.principal_corrigido),
        num(l.juros),
        num(l.multa),
        num(l.subtotal),
      ].join(';'),
    )
  }

  // O rodapé carrega o que não é por operação: honorários e custas incidem sobre o
  // conjunto, e distribuí-los rateados pelas linhas inventaria uma precisão que a
  // sentença não tem.
  linhas.push('')
  linhas.push(`Principal;${num(r.principal)}`)
  linhas.push(`Correção monetária;${num(r.correcao)}`)
  linhas.push(`Juros de mora;${num(r.juros)}`)
  linhas.push(`Multa;${num(r.multa)}`)
  linhas.push(`Honorários (${r.parametros.honorarios_pct}%);${num(r.honorarios)}`)
  linhas.push(`Custas;${num(r.custas)}`)
  linhas.push(`TOTAL;${num(r.total)}`)

  if (r.competencias_sem_indice.length > 0) {
    linhas.push('')
    linhas.push(`Competências SEM índice na tabela;${r.competencias_sem_indice.join(' ')}`)
  }

  return linhas.join('\r\n')
}
