import assert from 'node:assert/strict'
import { test } from 'node:test'
import { horarioDaConfirmacao, quandoConfirmar } from './lembretes.ts'

/**
 * A confirmação tem HORA MARCADA (25/09/2026): 9h do dia da reunião, ou uma hora
 * antes quando a reunião é às 9h ou mais cedo. É o único lembrete.
 */

const SP = 'America/Sao_Paulo'
const brt = (iso: string): Date => new Date(`${iso}-03:00`)

// ─── Horário da confirmação ─────────────────────────────────────────────────

test('reunião à tarde: confirmação às 9h do mesmo dia', () => {
  assert.equal(horarioDaConfirmacao(brt('2026-09-23T14:00:00'), SP).toISOString(), brt('2026-09-23T09:00:00').toISOString())
})

test('reunião às 9h30: ainda às 9h', () => {
  assert.equal(horarioDaConfirmacao(brt('2026-09-23T09:30:00'), SP).toISOString(), brt('2026-09-23T09:00:00').toISOString())
})

test('reunião às 9h: confirmação às 8h', () => {
  assert.equal(horarioDaConfirmacao(brt('2026-09-23T09:00:00'), SP).toISOString(), brt('2026-09-23T08:00:00').toISOString())
})

test('reunião antes das 9h: uma hora antes', () => {
  assert.equal(horarioDaConfirmacao(brt('2026-09-23T08:30:00'), SP).toISOString(), brt('2026-09-23T07:30:00').toISOString())
})

// ─── Quando enfileirar ──────────────────────────────────────────────────────

const REUNIAO = brt('2026-09-23T14:00:00')
const MARCADA_ONTEM = brt('2026-09-22T11:00:00')

test('a rodada das 8:10 enfileira a confirmação das 9h', () => {
  const r = quandoConfirmar({ reuniao: REUNIAO, agora: brt('2026-09-23T08:10:00'), criadaEm: MARCADA_ONTEM, timezone: SP })
  assert.equal(r?.toISOString(), brt('2026-09-23T09:00:00').toISOString())
})

test('na véspera ainda não: a confirmação entra na fila perto da hora', () => {
  const r = quandoConfirmar({ reuniao: REUNIAO, agora: brt('2026-09-22T18:10:00'), criadaEm: MARCADA_ONTEM, timezone: SP })
  assert.equal(r, null)
})

test('reunião às 9h: a rodada das 7:10 enfileira para as 8h', () => {
  const reuniao = brt('2026-09-23T09:00:00')
  const r = quandoConfirmar({ reuniao, agora: brt('2026-09-23T07:10:00'), criadaEm: MARCADA_ONTEM, timezone: SP })
  assert.equal(r?.toISOString(), brt('2026-09-23T08:00:00').toISOString())
})

test('rodada perdida: a seguinte manda na hora, com até uma hora de atraso', () => {
  const agora = brt('2026-09-23T09:10:00')
  const r = quandoConfirmar({ reuniao: REUNIAO, agora, criadaEm: MARCADA_ONTEM, timezone: SP })
  assert.equal(r?.toISOString(), agora.toISOString())
  // Duas horas depois já não é "bom dia".
  assert.equal(
    quandoConfirmar({ reuniao: REUNIAO, agora: brt('2026-09-23T11:10:00'), criadaEm: MARCADA_ONTEM, timezone: SP }),
    null,
  )
})

test('reunião marcada depois das 9h do próprio dia não recebe o bom dia', () => {
  const r = quandoConfirmar({
    reuniao: REUNIAO,
    agora: brt('2026-09-23T10:10:00'),
    criadaEm: brt('2026-09-23T09:40:00'),
    timezone: SP,
  })
  assert.equal(r, null)
})

test('marcada cedo no próprio dia, antes das 9h: recebe às 9h', () => {
  const r = quandoConfirmar({
    reuniao: REUNIAO,
    agora: brt('2026-09-23T08:10:00'),
    criadaEm: brt('2026-09-23T07:51:00'),
    timezone: SP,
  })
  assert.equal(r?.toISOString(), brt('2026-09-23T09:00:00').toISOString())
})

test('reunião que já começou não recebe confirmação', () => {
  const r = quandoConfirmar({ reuniao: REUNIAO, agora: brt('2026-09-23T14:05:00'), criadaEm: MARCADA_ONTEM, timezone: SP })
  assert.equal(r, null)
})
