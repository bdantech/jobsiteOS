import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dentroDaJanela, partesNoFuso, proximaAbertura, proximaAberturaAposVirada } from './janela.ts'
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

// ─── Teto diário: a virada do dia, não "daqui a 12h" ────────────────────────

const JANELA_SP: JanelaEnvio = {
  timezone: 'America/Sao_Paulo',
  dias_semana: [1, 2, 3, 4, 5],
  hora_inicio: 9,
  hora_fim: 18,
}

/** 15/09/2026 é uma terça. 10h15 em SP = 13h15 UTC. */
test('o caso real: barrada às 10h15 de terça volta na QUARTA às 9h, não às 22h15 da terça', () => {
  const quandoBarrou = new Date('2026-09-15T13:15:00Z')
  const volta = proximaAberturaAposVirada(quandoBarrou, JANELA_SP)

  const l = partesNoFuso(volta, 'America/Sao_Paulo')
  assert.equal(l.dia, 16)
  assert.equal(l.hora, 9)
  // O defeito antigo dava exatamente isto, e é o que não pode voltar.
  assert.notEqual(volta.getTime(), quandoBarrou.getTime() + 12 * 3_600_000)
})

test('barrada de madrugada ainda assim espera a virada — o teto é do DIA, não das horas', () => {
  // 02h00 de quarta em SP: já é fora da janela, mas o contador do dia é o de quarta.
  const volta = proximaAberturaAposVirada(new Date('2026-09-16T05:00:00Z'), JANELA_SP)
  const l = partesNoFuso(volta, 'America/Sao_Paulo')
  assert.equal(l.dia, 17)
  assert.equal(l.hora, 9)
})

test('barrada na sexta pula o fim de semana', () => {
  // Sexta, 18/09/2026, 15h em SP.
  const volta = proximaAberturaAposVirada(new Date('2026-09-18T18:00:00Z'), JANELA_SP)
  const l = partesNoFuso(volta, 'America/Sao_Paulo')
  assert.equal(l.diaSemana, 1)
  assert.equal(l.dia, 21)
  assert.equal(l.hora, 9)
})

test('o que volta está sempre DENTRO da janela — é o contrato inteiro desta função', () => {
  for (const iso of [
    '2026-09-15T13:15:00Z',
    '2026-09-16T05:00:00Z',
    '2026-09-18T18:00:00Z',
    '2026-09-19T12:00:00Z',
    '2026-09-20T23:59:00Z',
  ]) {
    assert.equal(dentroDaJanela(proximaAberturaAposVirada(new Date(iso), JANELA_SP), JANELA_SP), true, iso)
  }
})
