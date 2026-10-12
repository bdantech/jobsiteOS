import assert from 'node:assert/strict'
import test from 'node:test'

import {
  agregarSemanas,
  diaEmSaoPaulo,
  fechadasPorMes,
  mesDaSemana,
  naSemana,
  semanaDe,
  semanaEmAberto,
  semanaFechadaEm,
  semanasDoMes,
  soFechadas,
  somarDias,
} from './semanas.js'

// ─── A definição de semana: a do 04q, e só ela ──────────────────────────────

test('a semana vai de segunda a domingo', () => {
  // Quarta, 07/10/2026.
  assert.deepEqual(semanaDe('2026-10-07'), { inicio: '2026-10-05', fim: '2026-10-11' })
  assert.deepEqual(semanaDe('2026-10-05'), { inicio: '2026-10-05', fim: '2026-10-11' })
  // O domingo pertence à semana que TERMINA nele, e não abre a seguinte.
  assert.deepEqual(semanaDe('2026-10-11'), { inicio: '2026-10-05', fim: '2026-10-11' })
})

test('a semana fechada é a mesma que o worker e o banco calculam', () => {
  // Os três casos de `janela.test.ts`: quarta, segunda e domingo.
  assert.deepEqual(semanaFechadaEm('2026-09-09'), { inicio: '2026-08-31', fim: '2026-09-06' })
  assert.deepEqual(semanaFechadaEm('2026-09-07'), { inicio: '2026-08-31', fim: '2026-09-06' })
  assert.deepEqual(semanaFechadaEm('2026-09-06'), { inicio: '2026-08-24', fim: '2026-08-30' })
})

test('fechada é a que o último dia JÁ PASSOU — no domingo ela ainda está aberta', () => {
  const s = { inicio: '2026-10-05', fim: '2026-10-11' }
  assert.equal(semanaEmAberto(s, '2026-10-08'), true)
  assert.equal(semanaEmAberto(s, '2026-10-11'), true)
  assert.equal(semanaEmAberto(s, '2026-10-12'), false)
})

test('a semana que atravessa a virada cai inteira no mês em que FECHA', () => {
  assert.equal(mesDaSemana({ inicio: '2026-09-28', fim: '2026-10-04' }), '2026-10')
  assert.equal(somarDias('2026-09-30', 1), '2026-10-01')
})

// ─── A semana em aberto nunca entra em média nem em total ───────────────────

const semanas = [
  { inicio: '2026-10-12', fim: '2026-10-18', em_aberto: true, leads: 10 },
  { inicio: '2026-10-05', fim: '2026-10-11', em_aberto: false, leads: 98 },
  { inicio: '2026-09-28', fim: '2026-10-04', em_aberto: false, leads: 102 },
  { inicio: '2026-09-21', fim: '2026-09-27', em_aberto: false, leads: 100 },
]

test('a semana em aberto NUNCA entra em total', () => {
  const a = agregarSemanas(semanas, (s) => s.leads)
  assert.equal(a.total, 300)
  assert.equal(a.semanas, 3)
})

test('a semana em aberto NUNCA entra em média', () => {
  const a = agregarSemanas(semanas, (s) => s.leads)
  // Com a parcial dentro, a média seria 77,5 e a semana corrente pareceria uma queda de 87%.
  assert.equal(a.media, 100)
  // E continua fora mesmo quando é a de maior número.
  const comPico = [{ ...semanas[0]!, leads: 9999 }, ...semanas.slice(1)]
  assert.equal(agregarSemanas(comPico, (s) => s.leads).media, 100)
})

test('sem nenhuma semana fechada a média é null — e nunca zero', () => {
  const a = agregarSemanas([semanas[0]!], (s) => s.leads)
  assert.equal(a.total, 0)
  assert.equal(a.media, null)
  assert.equal(a.semanas, 0)
})

test('o agregado mensal só soma semanas fechadas', () => {
  const porMes = fechadasPorMes(semanas)
  assert.deepEqual(porMes.map((m) => [m.mes, m.semanas.length]), [['2026-10', 2], ['2026-09', 1]])
  assert.equal(porMes.flatMap((m) => m.semanas).some((s) => s.em_aberto), false)
})

test('a lista do mês mantém a em aberto — quem a tira da conta é o agregado', () => {
  const outubro = semanasDoMes(semanas, '2026-10')
  assert.equal(outubro.length, 3)
  assert.equal(outubro[0]?.em_aberto, true)
  assert.equal(soFechadas(outubro).length, 2)
})

// ─── O dia é o de São Paulo ─────────────────────────────────────────────────

test('domingo às 22h de São Paulo ainda é domingo, embora já seja segunda em UTC', () => {
  // 11/10/2026 22:00 em São Paulo = 12/10 01:00 UTC.
  assert.equal(diaEmSaoPaulo('2026-10-12T01:00:00Z'), '2026-10-11')
  assert.equal(naSemana('2026-10-12T01:00:00Z', { inicio: '2026-10-05', fim: '2026-10-11' }), true)
  assert.equal(naSemana('2026-10-12T03:00:00Z', { inicio: '2026-10-05', fim: '2026-10-11' }), false)
  assert.equal(naSemana(null, { inicio: '2026-10-05', fim: '2026-10-11' }), false)
})
