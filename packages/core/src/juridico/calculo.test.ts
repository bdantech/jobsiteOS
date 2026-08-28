import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  calcularDivida,
  competenciaDeIndice,
  competenciasEntre,
  fatorCorrecao,
  memoriaParaCsv,
  type TabelaIndices,
} from './calculo.ts'
import { PARAMETROS_CALCULO_PADRAO, type ParametrosCalculo } from './schemas.ts'

// 1% ao mês, todo mês de 2026 — números redondos para a conta ser conferível a olho.
const TABELA: TabelaIndices = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, '0')}`, 1]),
)

test('a competência é o mês da data', () => {
  assert.equal(competenciaDeIndice('2026-03-17'), '2026-03')
})

test('competências entre duas datas, inclusive nas pontas', () => {
  assert.deepEqual(competenciasEntre('2026-01-15', '2026-04-02'), [
    '2026-01',
    '2026-02',
    '2026-03',
    '2026-04',
  ])
  assert.deepEqual(competenciasEntre('2026-11-01', '2027-01-31'), ['2026-11', '2026-12', '2027-01'])
  // Data-base ANTES do vencimento não corrige nada em vez de estourar.
  assert.deepEqual(competenciasEntre('2026-05-01', '2026-01-01'), [])
})

test('o mês do vencimento não é corrigido', () => {
  // Venceu em 31/01, base 28/02 → só a competência 2026-02 corrige.
  const f = fatorCorrecao('2026-01-31', '2026-02-28', TABELA)
  assert.equal(f.competencias, 1)
  assert.ok(Math.abs(f.fator - 1.01) < 1e-9)
})

test('fator acumula de forma composta', () => {
  const f = fatorCorrecao('2026-01-31', '2026-04-30', TABELA)
  assert.equal(f.competencias, 3)
  assert.ok(Math.abs(f.fator - 1.01 ** 3) < 1e-9)
})

test('competência faltante não corrige E aparece nominalmente', () => {
  const parcial: TabelaIndices = { '2026-02': 1 }
  const f = fatorCorrecao('2026-01-31', '2026-04-30', parcial)
  assert.deepEqual(f.faltantes, ['2026-03', '2026-04'])
  // Fator 1,01 e não 1,01³: o que falta não corrige, mas também não zera o que existe.
  assert.ok(Math.abs(f.fator - 1.01) < 1e-9)
})

test('a ordem das incidências é principal → correção → juros → multa → honorários', () => {
  const params: ParametrosCalculo = {
    ...PARAMETROS_CALCULO_PADRAO,
    juros_am: 1,
    juros_compostos: false,
    multa_pct: 2,
    honorarios_pct: 20,
  }
  const r = calcularDivida(
    [{ id: 'op-1', valor_original: 100_000, vencimento: '2026-01-31' }],
    params,
    TABELA,
    '2026-04-30',
  )

  // 3 competências corrigidas (fev, mar, abr) e 89 dias corridos de mora — que são
  // 2,9667 meses de 30 dias, NÃO três meses de calendário. A distinção é a razão de a
  // mora ser fracionada: arredondar para 3 daria R$ 34 a mais nesta única operação.
  const corrigido = Math.round(100_000 * 1.01 ** 3 * 100) / 100
  const meses = 89 / 30
  assert.equal(r.memoria[0]!.dias_em_atraso, 89)
  assert.equal(r.principal, 100_000)
  assert.equal(r.correcao, Math.round((corrigido - 100_000) * 100) / 100)
  // Juros SOBRE O CORRIGIDO, não sobre o principal.
  assert.equal(r.juros, Math.round(corrigido * 0.01 * meses * 100) / 100)
  // Multa sobre o corrigido, sem os juros.
  assert.equal(r.multa, Math.round(corrigido * 0.02 * 100) / 100)

  const subtotal = Math.round((corrigido + r.juros + r.multa) * 100) / 100
  assert.equal(r.honorarios, Math.round(subtotal * 0.2 * 100) / 100)
  assert.equal(r.total, Math.round((subtotal + r.honorarios) * 100) / 100)
})

test('juros compostos rendem mais que simples no mesmo período', () => {
  const base = { id: 'op', valor_original: 100_000, vencimento: '2026-01-31' }
  const simples = calcularDivida([base], { ...PARAMETROS_CALCULO_PADRAO, juros_compostos: false }, TABELA, '2026-12-31')
  const compostos = calcularDivida([base], { ...PARAMETROS_CALCULO_PADRAO, juros_compostos: true }, TABELA, '2026-12-31')
  assert.ok(compostos.juros > simples.juros)
})

test('mora fracionada não é truncada', () => {
  // 45 dias = 1,5 mês. Truncar para 1 subtrairia meio mês de juros de toda a carteira.
  const r = calcularDivida(
    [{ id: 'op', valor_original: 1000, vencimento: '2026-01-01' }],
    { ...PARAMETROS_CALCULO_PADRAO, juros_am: 1, juros_compostos: false, multa_pct: 0, honorarios_pct: 0 },
    {},
    '2026-02-15',
  )
  assert.equal(r.memoria[0]!.dias_em_atraso, 45)
  assert.equal(r.memoria[0]!.meses_em_atraso, 1.5)
  assert.equal(r.juros, 15)
})

test('custas entram por fora dos honorários', () => {
  const params: ParametrosCalculo = {
    ...PARAMETROS_CALCULO_PADRAO,
    juros_am: 0,
    multa_pct: 0,
    honorarios_pct: 10,
  }
  const r = calcularDivida(
    [{ id: 'op', valor_original: 1000, vencimento: '2026-01-01' }],
    params,
    {},
    '2026-01-01',
    500,
  )
  assert.equal(r.honorarios, 100) // 10% de 1000, e NÃO de 1500
  assert.equal(r.custas, 500)
  assert.equal(r.total, 1600)
})

test('incluir_custas desligado zera as custas sem mexer no resto', () => {
  const r = calcularDivida(
    [{ id: 'op', valor_original: 1000, vencimento: '2026-01-01' }],
    { ...PARAMETROS_CALCULO_PADRAO, juros_am: 0, multa_pct: 0, honorarios_pct: 0, incluir_custas: false },
    {},
    '2026-01-01',
    500,
  )
  assert.equal(r.custas, 0)
  assert.equal(r.total, 1000)
})

test('a memória sai linha a linha, uma por operação, com o fator conferível', () => {
  const r = calcularDivida(
    [
      { id: 'a', valor_original: 1000, vencimento: '2026-01-31', descricao: 'NF 100' },
      { id: 'b', valor_original: 2000, vencimento: '2026-02-28', descricao: 'NF 200' },
    ],
    PARAMETROS_CALCULO_PADRAO,
    TABELA,
    '2026-04-30',
  )
  assert.equal(r.memoria.length, 2)
  assert.equal(r.memoria[0]!.descricao, 'NF 100')
  assert.equal(r.memoria[0]!.fator_correcao, Math.round(1.01 ** 3 * 1e6) / 1e6)
  assert.equal(r.memoria[1]!.fator_correcao, Math.round(1.01 ** 2 * 1e6) / 1e6)
  assert.equal(r.principal, 3000)
})

test('os buracos de índice sobem para o topo do resultado', () => {
  const r = calcularDivida(
    [
      { id: 'a', valor_original: 1000, vencimento: '2026-01-31' },
      { id: 'b', valor_original: 1000, vencimento: '2026-02-28' },
    ],
    PARAMETROS_CALCULO_PADRAO,
    { '2026-02': 1 },
    '2026-04-30',
  )
  assert.deepEqual(r.competencias_sem_indice, ['2026-03', '2026-04'])
})

test('os parâmetros usados viajam junto do resultado', () => {
  const params: ParametrosCalculo = { ...PARAMETROS_CALCULO_PADRAO, juros_am: 2, indice: 'igpm' }
  const r = calcularDivida([{ id: 'a', valor_original: 10, vencimento: '2026-01-01' }], params, {}, '2026-02-01')
  assert.deepEqual(r.parametros, params)
  assert.equal(r.memoria[0]!.indice, 'igpm')
})

test('carteira vazia devolve zeros, não NaN', () => {
  const r = calcularDivida([], PARAMETROS_CALCULO_PADRAO, TABELA, '2026-04-30')
  assert.equal(r.total, 0)
  assert.equal(r.principal, 0)
  assert.deepEqual(r.memoria, [])
})

test('o CSV sai com ; e vírgula decimal, e carrega o rodapé', () => {
  const r = calcularDivida(
    [{ id: 'a', valor_original: 1000, vencimento: '2026-01-31', descricao: 'NF 100' }],
    PARAMETROS_CALCULO_PADRAO,
    TABELA,
    '2026-04-30',
  )
  const csv = memoriaParaCsv(r)
  const linhas = csv.split('\r\n')
  assert.ok(linhas[0]!.startsWith('Operação;Vencimento;'))
  assert.ok(linhas[1]!.includes('NF 100;2026-01-31;1000,00'))
  assert.ok(csv.includes('TOTAL;'))
})

test('o ; do texto não quebra a coluna do CSV', () => {
  const r = calcularDivida(
    [{ id: 'a', valor_original: 10, vencimento: '2026-01-01', descricao: 'NF 1; NF 2' }],
    PARAMETROS_CALCULO_PADRAO,
    {},
    '2026-02-01',
  )
  const linha = memoriaParaCsv(r).split('\r\n')[1]!
  assert.equal(linha.split(';').length, 10)
})
