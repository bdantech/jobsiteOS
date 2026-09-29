import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diasEmAtraso, emAtraso, liquidacaoEsperada, proximoDiaUtil } from './datas.ts'

// Setembro de 2026: 25 sexta, 26 sábado, 27 domingo, 28 segunda; 07 é feriado (segunda).

test('vence segunda: paga segunda, liquida terça, em atraso só na quarta', () => {
  assert.equal(liquidacaoEsperada('2026-09-28'), '2026-09-29')
  assert.equal(emAtraso('2026-09-28', '2026-09-28'), false)
  assert.equal(emAtraso('2026-09-28', '2026-09-29'), false)
  assert.equal(emAtraso('2026-09-28', '2026-09-30'), true)
})

test('vence sábado ou domingo: paga segunda, liquida terça, em atraso na quarta', () => {
  for (const venc of ['2026-09-26', '2026-09-27']) {
    assert.equal(proximoDiaUtil(venc), '2026-09-28')
    assert.equal(liquidacaoEsperada(venc), '2026-09-29')
    assert.equal(emAtraso(venc, '2026-09-29'), false)
    assert.equal(emAtraso(venc, '2026-09-30'), true)
  }
})

test('vence sexta: liquida segunda, em atraso na terça', () => {
  assert.equal(liquidacaoEsperada('2026-09-25'), '2026-09-28')
  assert.equal(emAtraso('2026-09-25', '2026-09-28'), false)
  assert.equal(emAtraso('2026-09-25', '2026-09-29'), true)
})

test('feriado bancário empurra o pagamento e a compensação', () => {
  // vence no feriado de 07/09 (segunda): paga 08, liquida 09
  assert.equal(liquidacaoEsperada('2026-09-07'), '2026-09-09')
  // vence sexta 04/09: a compensação pula o feriado de segunda
  assert.equal(liquidacaoEsperada('2026-09-04'), '2026-09-08')
})

test('os dias de atraso contam do vencimento original, mas só depois da liquidação esperada', () => {
  assert.equal(diasEmAtraso('2026-09-26', '2026-09-29'), 0)
  assert.equal(diasEmAtraso('2026-09-26', '2026-09-30'), 4)
})
