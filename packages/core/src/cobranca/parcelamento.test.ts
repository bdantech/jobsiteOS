import assert from 'node:assert/strict'
import { test } from 'node:test'
import { atualizarDividaCobranca } from './atualizacao.ts'
import { compararCenariosParcelamento, simularParcelamento } from './parcelamento.ts'

test('Price sem juros: parcelas iguais e total igual ao à vista', () => {
  const s = simularParcelamento({ valor: 1000, qtd_parcelas: 3, primeira_parcela: '2026-10-10', sistema: 'price' })
  assert.deepEqual(
    s.parcelas.map((p) => p.valor),
    [333.33, 333.33, 333.34],
  )
  assert.equal(s.valor_total_projetado, 1000)
  assert.equal(s.custo_parcelamento, 0)
})

test('Price com juros: prestação constante (exceto o ajuste de centavos) e saldo zera', () => {
  const s = simularParcelamento({
    valor: 100_000,
    qtd_parcelas: 12,
    primeira_parcela: '2026-10-10',
    juros_mes: 2,
    sistema: 'price',
  })
  // PMT = 100000 × 0,02 / (1 − 1,02^−12) = 9.455,96
  assert.equal(s.parcelas[0]!.valor, 9455.96)
  assert.equal(s.parcelas.at(-1)!.saldo_devedor, 0)
  const amort = s.parcelas.reduce((t, p) => t + p.amortizacao, 0)
  assert.equal(Math.round(amort * 100) / 100, 100_000)
  assert.ok(s.custo_parcelamento > 13_000 && s.custo_parcelamento < 13_600)
})

test('SAC: amortização constante e prestação decrescente', () => {
  const s = simularParcelamento({ valor: 12_000, qtd_parcelas: 4, primeira_parcela: '2026-10-10', juros_mes: 1, sistema: 'sac' })
  assert.deepEqual(s.parcelas.map((p) => p.amortizacao), [3000, 3000, 3000, 3000])
  assert.deepEqual(s.parcelas.map((p) => p.juros), [120, 90, 60, 30])
  assert.ok(s.parcelas[0]!.valor > s.parcelas[3]!.valor)
})

test('entrada em % vira a parcela 0 e sai do financiado', () => {
  const s = simularParcelamento({
    valor: 50_000,
    entrada_pct: 20,
    qtd_parcelas: 2,
    primeira_parcela: '2026-10-31',
  })
  assert.equal(s.entrada, 10_000)
  assert.equal(s.valor_financiado, 40_000)
  assert.equal(s.parcelas[0]!.numero, 0)
  assert.equal(s.parcelas[0]!.vencimento, null)
  // mensal a partir de 31/10: a segunda parcela cai no fim de novembro, não em 01/12
  assert.equal(s.parcelas[2]!.vencimento, '2026-11-30')
})

test('juros quinzenais usam a taxa equivalente composta, não a metade', () => {
  const s = simularParcelamento({
    valor: 10_000,
    qtd_parcelas: 2,
    primeira_parcela: '2026-10-10',
    juros_mes: 2,
    periodicidade: 'quinzenal',
  })
  assert.ok(Math.abs(s.taxa_periodo - (Math.sqrt(1.02) - 1)) < 1e-8)
  assert.equal(s.parcelas[1]!.vencimento, '2026-10-25')
})

test('até três cenários lado a lado sobre o mesmo valor', () => {
  const r = compararCenariosParcelamento(30_000, [
    { qtd_parcelas: 3, primeira_parcela: '2026-10-10' },
    { qtd_parcelas: 6, primeira_parcela: '2026-10-10', juros_mes: 1 },
    { qtd_parcelas: 6, primeira_parcela: '2026-10-10', juros_mes: 1, sistema: 'sac' },
  ])
  assert.equal(r.length, 3)
  assert.ok(r[2]!.juros_total < r[1]!.juros_total, 'SAC paga menos juros que Price no mesmo prazo')
  assert.throws(() => compararCenariosParcelamento(1, [{}, {}, {}, {}] as never))
})

test('atualização reusa o motor do Jurídico: correção, juros pro rata, multa e honorários', () => {
  const r = atualizarDividaCobranca(
    [{ id: 't1', valor_face: 10_000, vencimento: '2026-06-15' }],
    { juros_mora_mes: 1, multa_pct: 2, honorarios_pct: 10, indice: 'igpm', juros_pro_rata: true },
    { '2026-07': 0.5, '2026-08': 0.5 },
    '2026-08-29',
  )
  // fator 1,005² = 1,010025 → corrigido 10.100,25; 75 dias = 2,5 meses de juros
  assert.equal(r.memoria[0]!.principal_corrigido, 10_100.25)
  assert.equal(r.juros, 252.51)
  assert.equal(r.multa, 202.01)
  assert.equal(r.honorarios, Math.round((10_100.25 + 252.51 + 202.01) * 10) / 100)
  assert.equal(r.indice_cobranca, 'igpm')
})

test("índice 'nenhum' não corrige nem acusa competência faltante; juros por mês cheio truncam", () => {
  const r = atualizarDividaCobranca(
    [{ id: 't1', valor_face: 10_000, vencimento: '2026-06-15' }],
    { juros_mora_mes: 1, multa_pct: 0, honorarios_pct: 0, indice: 'nenhum', juros_pro_rata: false },
    {},
    '2026-08-29',
  )
  assert.equal(r.correcao, 0)
  assert.deepEqual(r.competencias_sem_indice, [])
  // 75 dias = 2 meses completos
  assert.equal(r.juros, 200)
})
