import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calibrarCarteira, desvioRelativo, type AmostraCarteira } from './calibracao.ts'

const amostra = (
  taxa: number | null,
  dias: number | null,
  valor: number | null,
): AmostraCarteira => ({
  monthly_interest_rate: taxa,
  anticipation_days: dias,
  gross_value: valor,
})

test('mediana de cada métrica, com a contagem que a sustenta', () => {
  const r = calibrarCarteira([
    amostra(2.0, 10, 10_000),
    amostra(2.2, 20, 20_000),
    amostra(2.4, 30, 30_000),
    amostra(2.6, 40, 40_000),
    amostra(2.8, 50, 50_000),
  ])
  assert.equal(r.taxa_am.valor, 2.4)
  assert.equal(r.prazo_dias.valor, 30)
  assert.equal(r.valor_medio_nf.valor, 30_000)
  assert.equal(r.amostras, 5)
  assert.equal(r.taxa_am.n, 5)
})

test('mediana, não média — uma antecipação gigante não reescreve o ticket', () => {
  const r = calibrarCarteira([
    amostra(2, 30, 30_000),
    amostra(2, 30, 31_000),
    amostra(2, 30, 32_000),
    amostra(2, 30, 33_000),
    amostra(2, 30, 4_000_000),
  ])
  assert.equal(r.valor_medio_nf.valor, 32_000)
})

test('abaixo do mínimo de amostras devolve null, não um número frágil', () => {
  const r = calibrarCarteira([amostra(2, 30, 30_000), amostra(3, 40, 40_000)])
  assert.equal(r.taxa_am.valor, null)
  assert.equal(r.taxa_am.n, 2)
  assert.equal(r.amostras, 2)
})

test('cada métrica tem o próprio n — falta de prazo não invalida a taxa', () => {
  const r = calibrarCarteira([
    amostra(2.0, null, 10_000),
    amostra(2.2, null, 20_000),
    amostra(2.4, null, 30_000),
    amostra(2.6, null, 40_000),
    amostra(2.8, null, 50_000),
  ])
  assert.equal(r.taxa_am.valor, 2.4)
  assert.equal(r.prazo_dias.valor, null)
  assert.equal(r.prazo_dias.n, 0)
})

test('zero e negativo saem da amostra — taxa 0 não é taxa', () => {
  const r = calibrarCarteira(
    [
      amostra(0, 30, 30_000),
      amostra(-1, 30, 30_000),
      amostra(2, 30, 30_000),
      amostra(2, 30, 30_000),
    ],
    2,
  )
  assert.equal(r.taxa_am.n, 2)
  assert.equal(r.taxa_am.valor, 2)
})

test('desvio relativo compara o configurado com a carteira', () => {
  assert.ok(Math.abs((desvioRelativo(2.6, 2.0) as number) - 30) < 1e-9)
  assert.equal(desvioRelativo(2.0, 2.0), 0)
  assert.equal(desvioRelativo(null, 2.0), null)
  assert.equal(desvioRelativo(2.6, null), null)
  assert.equal(desvioRelativo(2.6, 0), null)
})
