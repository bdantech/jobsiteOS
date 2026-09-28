import assert from 'node:assert/strict'
import { test } from 'node:test'
import { explicarReconciliacao, type ReconciliacaoGrupo } from './reconciliacao.ts'

const base: ReconciliacaoGrupo = {
  sacado_matriz_cnpj: '31655458000102',
  aberto: 1_414_252,
  vencido: 736_186,
  a_vencer: 678_066,
  qtd_vencidos: 40,
  consumido: 675_056,
  consumido_em: '2026-09-28T14:22:09Z',
  vencido_estimado: 0,
  situacao: 'em_dia',
}

test('em dia: diz que os vencidos provavelmente já foram pagos, com os números da conta', () => {
  const t = explicarReconciliacao(base)
  assert.match(t, /provavelmente já foram pagos/)
  assert.match(t, /675\.056/)
})

test('parcial: dá o valor estimado e avisa que não sabemos quais títulos', () => {
  const t = explicarReconciliacao({ ...base, situacao: 'parcial', vencido_estimado: 450_000 })
  assert.match(t, /450\.000/)
  assert.match(t, /Não sabemos quais/)
})

test('sem dado: não afirma nada sobre pagamento', () => {
  assert.match(explicarReconciliacao({ ...base, situacao: 'sem_dado', consumido: null, vencido_estimado: null }), /não há como confirmar/)
})
