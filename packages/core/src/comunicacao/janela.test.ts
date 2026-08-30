import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dentroDaJanela, proximaAbertura } from './janela.ts'
import type { JanelaEnvio } from './schemas.ts'

const JANELA: JanelaEnvio = {
  dias_semana: [1, 2, 3, 4, 5],
  hora_inicio: 9,
  hora_fim: 18,
  timezone: 'America/Sao_Paulo',
}

// 2026-08-27 é uma quinta-feira. UTC-3 em São Paulo (sem horário de verão).
const quintaAs10 = new Date('2026-08-27T13:00:00Z') // 10h em SP
const quintaAs22 = new Date('2026-08-28T01:00:00Z') // 22h de quinta em SP
const sabadoAo12 = new Date('2026-08-29T15:00:00Z') // sábado 12h em SP

test('dentro do horário comercial de um dia útil, a janela está aberta', () => {
  assert.equal(dentroDaJanela(quintaAs10, JANELA), true)
})

test('às 22h a janela está fechada — e às 18h em ponto também', () => {
  assert.equal(dentroDaJanela(quintaAs22, JANELA), false)
  const quintaAs18 = new Date('2026-08-27T21:00:00Z')
  assert.equal(dentroDaJanela(quintaAs18, JANELA), false)
  const quintaAs1759 = new Date('2026-08-27T20:59:00Z')
  assert.equal(dentroDaJanela(quintaAs1759, JANELA), true)
})

test('fim de semana está fora, mesmo em horário comercial', () => {
  assert.equal(dentroDaJanela(sabadoAo12, JANELA), false)
})

test('quem já está dentro recebe o próprio instante de volta', () => {
  assert.equal(proximaAbertura(quintaAs10, JANELA).getTime(), quintaAs10.getTime())
})

test('às 22h de quinta, a próxima abertura é 9h de sexta — e não segunda', () => {
  const abre = proximaAbertura(quintaAs22, JANELA)
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  })
  assert.equal(fmt.format(abre).includes('09'), true)
  assert.equal(abre.getTime() > quintaAs22.getTime(), true)
  assert.equal(dentroDaJanela(abre, JANELA), true)
})

test('no sábado, a próxima abertura pula para segunda de manhã', () => {
  const abre = proximaAbertura(sabadoAo12, JANELA)
  assert.equal(dentroDaJanela(abre, JANELA), true)
  // Segunda 9h em SP é 12h UTC do dia 31/08/2026.
  assert.equal(abre.toISOString(), '2026-08-31T12:00:00.000Z')
})

test('às 7h de uma terça, a abertura é às 9h da MESMA terça', () => {
  const tercaAs7 = new Date('2026-09-01T10:00:00Z')
  const abre = proximaAbertura(tercaAs7, JANELA)
  assert.equal(abre.toISOString(), '2026-09-01T12:00:00.000Z')
})

test('janela impossível não trava o worker num laço', () => {
  const impossivel: JanelaEnvio = { ...JANELA, dias_semana: [] }
  assert.equal(proximaAbertura(quintaAs10, impossivel).getTime(), quintaAs10.getTime())
})
