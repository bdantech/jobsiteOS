import { somarDiasCorridos, somarMeses } from './datas.js'
import {
  simulacaoParcelamentoSchema,
  type PeriodicidadeAcordo,
  type SimulacaoParcelamentoInput,
  type SistemaAmortizacao,
} from './schemas.js'

/**
 * Simulador de parcelamento do acordo (Prompt 07 §9.2): Price ou SAC, entrada em valor
 * ou %, periodicidade mensal/quinzenal/semanal.
 *
 * O juro é dado AO MÊS (é como se negocia), e convertido para a taxa equivalente do
 * período por capitalização composta: 1% a.m. em parcelas quinzenais é
 * (1,01)^(1/2) − 1 por quinzena, e não 0,5% — que daria um custo menor que o anunciado.
 *
 * Centavos: cada parcela é arredondada, e a ÚLTIMA absorve o resíduo, para que a soma das
 * amortizações feche exatamente o valor financiado. Um cronograma que soma R$ 0,03 a
 * menos vira uma discussão na última parcela.
 */

export interface ParcelaSimulada {
  /** 0 = entrada. */
  numero: number
  vencimento: string | null
  amortizacao: number
  juros: number
  valor: number
  saldo_devedor: number
}

export interface SimulacaoParcelamento {
  sistema: SistemaAmortizacao
  periodicidade: PeriodicidadeAcordo
  valor_a_vista: number
  entrada: number
  valor_financiado: number
  juros_mes: number
  taxa_periodo: number
  qtd_parcelas: number
  parcelas: ParcelaSimulada[]
  juros_total: number
  valor_total_projetado: number
  /** Quanto o parcelamento custa a mais que o pagamento à vista. */
  custo_parcelamento: number
}

const c = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const PERIODOS_POR_MES: Record<PeriodicidadeAcordo, number> = { mensal: 1, quinzenal: 2, semanal: 30 / 7 }

function vencimentoDa(primeira: string, periodicidade: PeriodicidadeAcordo, indice: number): string {
  if (periodicidade === 'mensal') return somarMeses(primeira, indice)
  return somarDiasCorridos(primeira, indice * (periodicidade === 'quinzenal' ? 15 : 7))
}

export function simularParcelamento(input: SimulacaoParcelamentoInput): SimulacaoParcelamento {
  const e = simulacaoParcelamentoSchema.parse(input)
  const entrada = c(e.entrada_pct !== undefined ? (e.valor * e.entrada_pct) / 100 : e.entrada)
  if (entrada >= e.valor) {
    throw new Error('A entrada cobre o valor inteiro: isso é pagamento à vista, não parcelamento.')
  }
  const financiado = c(e.valor - entrada)
  const n = e.qtd_parcelas
  const taxa = (1 + e.juros_mes / 100) ** (1 / PERIODOS_POR_MES[e.periodicidade]) - 1

  const parcelas: ParcelaSimulada[] = []
  if (entrada > 0) {
    parcelas.push({ numero: 0, vencimento: null, amortizacao: entrada, juros: 0, valor: entrada, saldo_devedor: financiado })
  }

  let saldo = financiado
  const pmt = taxa === 0 ? financiado / n : (financiado * taxa) / (1 - (1 + taxa) ** -n)
  const amortSac = financiado / n

  for (let i = 1; i <= n; i++) {
    const juros = c(saldo * taxa)
    let amortizacao = e.sistema === 'price' ? c(pmt - juros) : c(amortSac)
    if (i === n) amortizacao = c(saldo)
    const valor = c(amortizacao + juros)
    saldo = c(saldo - amortizacao)
    parcelas.push({
      numero: i,
      vencimento: vencimentoDa(e.primeira_parcela, e.periodicidade, i - 1),
      amortizacao,
      juros,
      valor,
      saldo_devedor: saldo,
    })
  }

  const juros_total = c(parcelas.reduce((s, p) => s + p.juros, 0))
  const total = c(parcelas.reduce((s, p) => s + p.valor, 0))

  return {
    sistema: e.sistema,
    periodicidade: e.periodicidade,
    valor_a_vista: c(e.valor),
    entrada,
    valor_financiado: financiado,
    juros_mes: e.juros_mes,
    taxa_periodo: Math.round(taxa * 1e8) / 1e8,
    qtd_parcelas: n,
    parcelas,
    juros_total,
    valor_total_projetado: total,
    custo_parcelamento: c(total - e.valor),
  }
}

/** Até três cenários lado a lado sobre o MESMO valor à vista (§9.2). */
export function compararCenariosParcelamento(
  valor: number,
  cenarios: readonly Omit<SimulacaoParcelamentoInput, 'valor'>[],
): SimulacaoParcelamento[] {
  if (cenarios.length > 3) throw new Error('No máximo três cenários.')
  return cenarios.map((cen) => simularParcelamento({ ...cen, valor }))
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** O `{{tabela_parcelas}}` da minuta. */
export function tabelaParcelasMarkdown(s: SimulacaoParcelamento): string {
  const linhas = ['| Parcela | Vencimento | Valor |', '|---|---|---:|']
  for (const p of s.parcelas) {
    linhas.push(
      `| ${p.numero === 0 ? 'Entrada' : `${p.numero}/${s.qtd_parcelas}`} | ${p.vencimento ? dataBr(p.vencimento) : 'Na assinatura'} | ${brl(p.valor)} |`,
    )
  }
  linhas.push('', `Total: **${brl(s.valor_total_projetado)}** (${s.sistema.toUpperCase()}, juros de ${s.juros_mes}% a.m.).`)
  return linhas.join('\n')
}
