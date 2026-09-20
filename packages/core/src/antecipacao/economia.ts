import { CONFIG_ECONOMIA_PADRAO, type Tipagem } from './schemas.js'

/**
 * A conta que ordena o funil.
 *
 * `receita_esperada = valor × (taxa_mensal / 100) × (dias_para_vencimento / 30)`
 *
 * Vive aqui, e não no worker, porque o Kanban ordena por ela, a IA a reporta e o
 * job a grava — três lugares que não podem discordar sobre quanto vale trabalhar
 * uma nota. A taxa é a `monthlyRateD0` do snapshot de crédito mais recente do
 * SACADO (é o risco dele que precifica), e cai no default de `antecipacao_config`
 * quando não há snapshot. A taxa efetivamente usada é gravada em `taxa_usada`,
 * senão a receita de ontem é impossível de auditar depois que a taxa muda.
 */

/** Dias/mês do cálculo comercial. Não é 30.44: o mercado cota em mês de 30. */
const DIAS_NO_MES = 30

export interface ReceitaEsperada {
  receita: number | null
  /** Taxa mensal em %, como veio do snapshot ou do default. */
  taxa: number
  /** true quando caiu no default — a UI marca a estimativa como menos confiável. */
  taxa_padrao: boolean
}

export function calcularReceitaEsperada(input: {
  valor: number | null | undefined
  diasParaVencimento: number | null | undefined
  /** monthlyRateD0 do snapshot mais recente do sacado, em % ao mês. */
  taxaMensal?: number | null
  taxaPadrao?: number
}): ReceitaEsperada {
  const padrao = input.taxaPadrao ?? CONFIG_ECONOMIA_PADRAO.taxa_mensal_padrao
  const temTaxa = typeof input.taxaMensal === 'number' && Number.isFinite(input.taxaMensal) && input.taxaMensal > 0
  const taxa = temTaxa ? (input.taxaMensal as number) : padrao

  const valor = input.valor
  const dias = input.diasParaVencimento

  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    return { receita: null, taxa, taxa_padrao: !temTaxa }
  }
  // Sem prazo não há o que antecipar — e uma nota vencida não gera receita
  // NEGATIVA, gera zero. Um número negativo aqui subiria invertido na ordenação.
  if (typeof dias !== 'number' || !Number.isFinite(dias) || dias <= 0) {
    return { receita: 0, taxa, taxa_padrao: !temTaxa }
  }

  const receita = valor * (taxa / 100) * (dias / DIAS_NO_MES)
  return { receita: Math.round(receita * 100) / 100, taxa, taxa_padrao: !temTaxa }
}

/**
 * O que o FORNECEDOR recebe se antecipar hoje: `valor − receita_esperada`.
 *
 * A receita esperada é o deságio — é a mesma conta, vista do outro lado da mesa.
 * O card mostra os dois porque eles respondem perguntas diferentes: a receita diz
 * se vale o meu tempo, o líquido é o número que eu falo em voz alta na ligação.
 *
 * ── ELE ANDA SOZINHO, TODO DIA ─────────────────────────────────────────────
 * `dias_para_vencimento` é calculado ao vivo na view (`vencimento - CURRENT_DATE`)
 * e a `receita_esperada` é regravada pela reclassificação encadeada ao sync
 * diário de NFs. Um dia a menos de prazo é um deságio menor e um líquido maior,
 * sem ninguém tocar em nada.
 *
 * ── POR QUE DERIVAR, E NÃO RECALCULAR ──────────────────────────────────────
 * Daria para refazer a conta aqui a partir de valor, taxa e dias. Não se faz: o
 * card mostra "Receita esperada" e "Líquido estimado" um ao lado do outro, e duas
 * contas independentes discordam no dia em que o job não roda — apresentando ao
 * comercial dois números que não fecham. Derivar de `receita_esperada` garante
 * que `valor = receita + líquido` sempre, mesmo com o dado velho.
 *
 * Sem receita não há líquido: `null` é "não sei", e um card que mostra o valor
 * cheio como se fosse líquido é pior que um traço.
 */
export interface CustosDaAntecipacao {
  /** O deságio do período. É a `receita_esperada` gravada na nota. */
  juros: number
  /** Tarifa de análise/cadastro. Proporcional ao valor até o limiar da matriz. */
  tac: number
  /** Seguro da operação — fixo POR NOTA. */
  seguro: number
  /** O que sai do valor de face antes de o dinheiro cair na conta. */
  total: number
}

/**
 * Tudo que é descontado de uma NF antecipada.
 *
 * ── O QUE FALTAVA, E COMO SE DESCOBRIU ──────────────────────────────────────
 * O líquido era `valor − receita_esperada`, e `receita_esperada` é só o JUROS.
 * Faltavam a TAC e o seguro — o número na tela era maior que o que o fornecedor
 * recebe, que é o erro mais caro possível num número dito em voz alta na ligação.
 *
 * As antecipações reais da plataforma provam a composição:
 *
 *   net_value = gross_value − total_spread − 125,00
 *
 * e `total_spread` embute juros E TAC. Numa amostra homogênea (3,0% a.m., 31
 * dias, 57 operações, r² = 0,995) a regressão do spread contra o valor devolve
 * uma parcela FIXA de R$ 226,20 — a TAC, dentro da faixa 150–300 da matriz. Os
 * R$ 125 aparecem como linha separada em toda operação desde 15/09/2026 e em
 * nenhuma antes: é tarifa nova, e vale daqui para frente.
 *
 * ── O SEGURO É POR NOTA, NÃO POR OPERAÇÃO ───────────────────────────────────
 * O documento 251 foi antecipado em cinco parcelas (251/1 a 251/5) e cada uma
 * debitou os seus R$ 125. A palavra "operação" na tarifa é a linha de
 * antecipação, e cada linha é uma nota.
 *
 * ── A INVARIANTE MUDOU, E ISSO É DELIBERADO ─────────────────────────────────
 * Antes valia `valor = receita + líquido`. Agora vale
 * `valor = juros + tac + seguro + líquido`. A receita da casa é juros + TAC; o
 * seguro é repasse. Manter a invariante velha exigiria esconder uma das parcelas,
 * e é justamente a parcela escondida que produziu o número errado.
 */
export function custosDaAntecipacao(input: {
  receitaEsperada: number | null | undefined
  tac: number | null | undefined
  seguro: number | null | undefined
}): CustosDaAntecipacao | null {
  const juros = input.receitaEsperada
  // Sem juros não há conta: `null` é "não sei", e um líquido que ignora a parcela
  // desconhecida mente com a confiança de quem mostra um número exato.
  if (typeof juros !== 'number' || !Number.isFinite(juros)) return null

  const tac = typeof input.tac === 'number' && Number.isFinite(input.tac) ? input.tac : 0
  const seguro =
    typeof input.seguro === 'number' && Number.isFinite(input.seguro) ? input.seguro : 0
  const cem = (n: number) => Math.round(n * 100) / 100

  return { juros: cem(juros), tac: cem(tac), seguro: cem(seguro), total: cem(juros + tac + seguro) }
}

/**
 * O que o FORNECEDOR recebe se antecipar hoje: `valor − juros − tac − seguro`.
 *
 * É o número que o comercial fala em voz alta na ligação, e por isso ele desce
 * de propósito: errar para baixo é uma boa surpresa; errar para cima é uma
 * promessa que a plataforma não cumpre.
 *
 * ── ELE ANDA SOZINHO, TODO DIA ─────────────────────────────────────────────
 * `dias_para_vencimento` é calculado ao vivo na view e a `receita_esperada` é
 * regravada pela reclassificação encadeada ao sync diário. Um dia a menos de
 * prazo é um deságio menor e um líquido maior, sem ninguém tocar em nada. A TAC
 * e o seguro não andam: são tarifa, não tempo.
 */
export function valorLiquidoEstimado(input: {
  valor: number | null | undefined
  receitaEsperada: number | null | undefined
  tac?: number | null
  seguro?: number | null
}): number | null {
  const { valor } = input
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null
  const custos = custosDaAntecipacao({
    receitaEsperada: input.receitaEsperada,
    tac: input.tac,
    seguro: input.seguro,
  })
  if (!custos) return null
  // Nota pequena com tarifa alta pode dar negativo, e o zero é a verdade: não
  // sobra nada. Um número negativo na tela seria lido como erro de sistema.
  return Math.max(0, Math.round((valor - custos.total) * 100) / 100)
}

/**
 * A tipagem comercial do fornecedor (§1). É o que decide o TOM da abordagem, e
 * por isso é do fornecedor e não da nota:
 *   aquisicao   → nem conhece a plataforma;
 *   ativacao    → cadastrado e nunca usou (o problema é ativação, não venda);
 *   recorrencia → já antecipou e deixou uma nota de fora.
 */
/**
 * O PISO DE OPERAÇÃO: nota de R$ 500 ou menos não se opera.
 *
 * Não é regra de risco nem de crédito — é aritmética. O custo fixo de uma operação
 * é a TAC mais o seguro de R$ 125, e numa nota pequena ele passa do valor da nota:
 * uma NF de R$ 48 com R$ 150 de TAC devolveria líquido NEGATIVO. Antes deste piso,
 * 19,6% das notas vivas do funil tinham líquido zero ou negativo — cada uma delas
 * um card que alguém podia abrir, ligar para o fornecedor e descobrir na conversa
 * que não havia o que oferecer.
 *
 * O corte fica no VALOR da nota, e não no líquido calculado, de propósito: o líquido
 * depende da TAC do sacado e da taxa do dia, então a mesma nota entraria e sairia do
 * funil conforme a precificação mudasse. "Abaixo de quinhentos reais não operamos" é
 * uma frase que o vendedor consegue repetir ao telefone; "abaixo de quinhentos reais
 * depende da tarifa vigente do seu sacado" não é.
 *
 * Inclusivo no limite: R$ 500,00 exatos NÃO opera.
 */
export const VALOR_MINIMO_OPERAVEL_PADRAO = 500

export function abaixoDoMinimoOperavel(
  valor: number | null | undefined,
  minimo: number = VALOR_MINIMO_OPERAVEL_PADRAO,
): boolean {
  // Valor ausente não é motivo para esconder a nota — mesma regra da natureza vazia.
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return false
  return valor <= minimo
}

/** Frase pronta para a interface, no mesmo formato de `motivoNaoOperavel`. */
export function motivoValorAbaixoDoMinimo(
  minimo: number = VALOR_MINIMO_OPERAVEL_PADRAO,
): string {
  return `Abaixo de ${formatarMoeda(minimo)} — o custo fixo da operação não cabe na nota.`
}

export function calcularTipagem(input: {
  cadastrado: boolean | null | undefined
  jaAntecipou: boolean | null | undefined
}): Tipagem {
  if (!input.cadastrado) return 'aquisicao'
  return input.jaAntecipou ? 'recorrencia' : 'ativacao'
}

/** Dias inteiros entre hoje e o vencimento. Negativo quando já venceu. */
export function diasParaVencimento(
  vencimento: string | Date | null | undefined,
  hoje: Date = new Date(),
): number | null {
  if (!vencimento) return null
  const alvo = typeof vencimento === 'string' ? new Date(`${vencimento.slice(0, 10)}T00:00:00Z`) : vencimento
  if (Number.isNaN(alvo.getTime())) return null
  const base = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())
  return Math.round((alvo.getTime() - base) / 86_400_000)
}

/**
 * A régua de urgência do card (cor). Um número cru não comunica nada num card de
 * celular; três faixas comunicam. Os cortes acompanham o `minimo_operavel`.
 */
export type Urgencia = 'vencida' | 'critica' | 'atencao' | 'confortavel'

export function urgenciaDe(dias: number | null | undefined, minimoOperavel = 7): Urgencia {
  if (typeof dias !== 'number') return 'confortavel'
  if (dias < 0) return 'vencida'
  if (dias < minimoOperavel) return 'critica'
  if (dias < minimoOperavel * 3) return 'atencao'
  return 'confortavel'
}

export const URGENCIA_LABELS: Record<Urgencia, string> = {
  vencida: 'Vencida',
  critica: 'Crítica',
  atencao: 'Atenção',
  confortavel: 'Confortável',
}

// ─── Templates da outbox (§6) ───────────────────────────────────────────────

export interface VariaveisTemplate {
  fornecedor_nome: string
  qtd_notas: string
  valor_total: string
  sacado_principal: string
  receita_estimada_fornecedor: string
}

/**
 * Substituição de placeholders `{chave}`, e nada mais.
 *
 * Deliberadamente burra: nesta fase a mensagem é TEMPLATE, não geração por IA
 * (§10). Uma chave desconhecida é deixada como está — some-la em silêncio
 * esconderia o erro de digitação de quem escreveu o template, e a Outbox existe
 * justamente para que esse erro seja visto antes de qualquer canal ser ligado.
 */
export function renderizarTemplate(template: string, vars: Partial<VariaveisTemplate>): string {
  return template.replace(/\{(\w+)\}/g, (original, chave: string) => {
    const valor = (vars as Record<string, string | undefined>)[chave]
    return valor ?? original
  })
}

export function formatarMoeda(valor: number | null | undefined): string {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '—'
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
