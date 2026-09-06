import assert from 'node:assert/strict'
import test from 'node:test'

import { semanaFechada } from './janela.js'

/**
 * A janela padrão do report é a semana ISO FECHADA — segunda a domingo, já terminada.
 *
 * Abrir na semana corrente compararia três dias com sete, e toda segunda-feira o report
 * diria que a semana desabou. O teste existe porque aritmética de dia da semana é o tipo de
 * código que parece certo e erra na virada.
 */

test('numa quarta, a janela é a segunda a domingo da semana passada', () => {
  // Quarta, 09/09/2026.
  const r = semanaFechada(new Date('2026-09-09T10:00:00Z'))
  assert.deepEqual(r, { inicio: '2026-08-31', fim: '2026-09-06' })
})

test('numa segunda, a janela é a semana que acabou de fechar no domingo', () => {
  // Segunda, 07/09/2026 — o dia em que o cron manda o report.
  const r = semanaFechada(new Date('2026-09-07T09:00:00Z'))
  assert.deepEqual(r, { inicio: '2026-08-31', fim: '2026-09-06' })
})

test('num domingo, a janela é a semana ANTERIOR — o domingo de hoje ainda não acabou', () => {
  // Domingo, 06/09/2026. A semana 31/08–06/09 termina hoje e ainda está correndo.
  const r = semanaFechada(new Date('2026-09-06T23:00:00Z'))
  assert.deepEqual(r, { inicio: '2026-08-24', fim: '2026-08-30' })
})

test('a janela tem sempre sete dias, em qualquer dia do ano', () => {
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i))
    const { inicio, fim } = semanaFechada(d)
    const dias = (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000
    assert.equal(dias, 6, `${d.toISOString().slice(0, 10)} deu ${dias + 1} dias`)
    // E ela nunca invade o futuro.
    assert.ok(Date.parse(`${fim}T00:00:00Z`) < d.getTime() + 86_400_000)
  }
})

test('a janela começa numa segunda e termina num domingo, sempre', () => {
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i * 6))
    const { inicio, fim } = semanaFechada(d)
    assert.equal(new Date(`${inicio}T12:00:00Z`).getUTCDay(), 1, `${inicio} não é segunda`)
    assert.equal(new Date(`${fim}T12:00:00Z`).getUTCDay(), 0, `${fim} não é domingo`)
  }
})
