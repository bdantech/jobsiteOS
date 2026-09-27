import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calcularPerdaSegurada, type TituloPerda } from './perda.ts'

const titulo = (id: string, valor: number, cedido: number | null = valor * 0.9, segurado = true): TituloPerda => ({
  id,
  descricao: id,
  valor_devido: valor,
  segurado,
  valor_cedido: cedido,
})

const base = { percentagem_segurada: 0.9, franquia: 20_000, limite_credito_vigente: 1_000_000 }

test('perda abaixo da franquia não é indenizável', () => {
  const r = calcularPerdaSegurada({ ...base, titulos: [titulo('a', 15_000)], creditos: {} })
  assert.equal(r.perda_segurada, 15_000)
  assert.equal(r.indenizavel, false)
  assert.equal(r.indenizacao, 0)
  assert.match(r.memoria.at(-1)!.origem, /26100/)
})

test('perda exatamente igual à franquia também não é (≤)', () => {
  const r = calcularPerdaSegurada({ ...base, titulos: [titulo('a', 20_000)], creditos: {} })
  assert.equal(r.indenizavel, false)
})

test('perda acima do limite: a base é o limite de crédito vigente', () => {
  const r = calcularPerdaSegurada({
    ...base,
    limite_credito_vigente: 300_000,
    titulos: [titulo('a', 500_000, 480_000)],
    creditos: {},
  })
  assert.equal(r.perda_segurada, 500_000)
  assert.equal(r.base_indenizavel, 300_000)
  assert.equal(r.indenizacao, 270_000)
  assert.equal(r.teto_aplicado, 'limite_credito')
})

test('recuperação parcial antes da Data da Perda reduz a perda segurada', () => {
  const r = calcularPerdaSegurada({
    ...base,
    titulos: [titulo('a', 100_000, 95_000), titulo('b', 50_000, 47_000)],
    creditos: { pagamentos: 30_000, abatimentos: 5_000 },
  })
  assert.equal(r.devido_total, 150_000)
  assert.equal(r.creditos, 35_000)
  assert.equal(r.perda_segurada, 115_000)
  assert.equal(r.indenizacao, 103_500)
  assert.ok(r.memoria.some((l) => l.rotulo === 'Pagamentos recebidos' && l.sinal === '-'))
})

test('o teto do valor pago ao cedente prevalece quando é menor', () => {
  const r = calcularPerdaSegurada({ ...base, titulos: [titulo('a', 100_000, 60_000)], creditos: {} })
  assert.equal(r.indenizacao, 60_000)
  assert.equal(r.teto_aplicado, 'valor_pago_cedente')
})

test('recebível não segurado sai da base', () => {
  const r = calcularPerdaSegurada({
    ...base,
    titulos: [titulo('a', 100_000), titulo('b', 40_000, 36_000, false)],
    creditos: {},
  })
  assert.equal(r.nao_segurados, 40_000)
  assert.equal(r.perda_segurada, 100_000)
})

test('limite ou valor cedido desconhecidos viram aviso, não número inventado', () => {
  const r = calcularPerdaSegurada({
    ...base,
    limite_credito_vigente: null,
    titulos: [titulo('a', 100_000, null)],
    creditos: {},
  })
  assert.equal(r.indenizacao, 90_000)
  assert.equal(r.avisos.length, 2)
})
