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
export function valorLiquidoEstimado(
  valor: number | null | undefined,
  receitaEsperada: number | null | undefined,
): number | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null
  if (typeof receitaEsperada !== 'number' || !Number.isFinite(receitaEsperada)) return null
  return Math.round((valor - receitaEsperada) * 100) / 100
}

/**
 * A tipagem comercial do fornecedor (§1). É o que decide o TOM da abordagem, e
 * por isso é do fornecedor e não da nota:
 *   aquisicao   → nem conhece a plataforma;
 *   ativacao    → cadastrado e nunca usou (o problema é ativação, não venda);
 *   recorrencia → já antecipou e deixou uma nota de fora.
 */
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
