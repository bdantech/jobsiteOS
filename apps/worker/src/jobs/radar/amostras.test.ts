import assert from 'node:assert/strict'
import { test } from 'node:test'
import { montarAmostra, type LinhaAmostra } from './amostras.ts'

/**
 * A regra que este arquivo protege custou uma medição para descobrir: amostra de
 * ranking publicado entra na calibração SEM headcount.
 *
 * O ranking informa pessoal graduado; a base é medida pelo Apollo. Nas 4 empresas
 * onde temos os dois, a razão ficou em 3,43 com p10 1,98 e p90 5,75 — espalhamento,
 * não fator. Deixar o graduado entrar calibraria a régua numa contagem e a aplicaria
 * em outra, multiplicando a estimativa da base inteira por volta de 6.
 */

const linha = (over: Partial<LinhaAmostra> = {}): LinhaAmostra => ({
  cnpj: '11222333000181',
  valor: '100000000',
  origem: 'declarado_cliente',
  tipo: 'construtora',
  funcionarios: 80,
  erp_mrr: '9000',
  qtd_usuarios_erp: 19,
  ...over,
})

test('amostra declarada leva todos os sinais, headcount incluído', () => {
  const a = montarAmostra(linha())
  assert.equal(a.origem_faturamento, 'declarado_cliente')
  assert.equal(a.faturamento_declarado, 100_000_000)
  assert.equal(a.funcionarios, 80)
  assert.equal(a.erp_mrr, 9000)
  assert.equal(a.qtd_usuarios_erp, 19)
})

test('amostra publicada entra SEM headcount — graduado não é Apollo', () => {
  const a = montarAmostra(linha({ origem: 'publicacao', funcionarios: 120 }))
  assert.equal(a.origem_faturamento, 'publicacao')
  assert.equal(a.funcionarios, null)
  // O que vem do NOSSO sistema atravessa: só o rótulo mudou de fonte.
  assert.equal(a.erp_mrr, 9000)
  assert.equal(a.qtd_usuarios_erp, 19)
  assert.equal(a.faturamento_declarado, 100_000_000)
})

test('MRR ausente vira null, não zero — zero seria um sinal falso', () => {
  const a = montarAmostra(linha({ erp_mrr: null }))
  assert.equal(a.erp_mrr, null)
})

test('numérico vem do Postgres como string e precisa virar número', () => {
  const a = montarAmostra(linha({ valor: '54594220.92', erp_mrr: '6474.03' }))
  assert.equal(a.faturamento_declarado, 54594220.92)
  assert.equal(a.erp_mrr, 6474.03)
})
