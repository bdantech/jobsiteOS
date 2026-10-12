import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fatosDaReuniao,
  reuniaoRealizada,
  reunioesDaJanela,
  type ReuniaoRegistro,
} from './reunioes-janela.js'

const S1 = { inicio: '2026-10-05', fim: '2026-10-11' }
const S2 = { inicio: '2026-10-12', fim: '2026-10-18' }
const AGORA = '2026-10-20T12:00:00Z'

const reuniao = (p: Partial<ReuniaoRegistro> = {}): ReuniaoRegistro => ({
  id: 'r1',
  agendada_em: '2026-10-09T15:00:00Z',
  inicio_em: '2026-10-13T13:00:00Z',
  desfecho: 'realizada',
  transcrita: true,
  ...p,
})

test('marcada na semana 1 e realizada na semana 2: conta em cada uma, na SUA métrica', () => {
  const r = [reuniao()]
  const s1 = reunioesDaJanela(r, S1, AGORA)
  const s2 = reunioesDaJanela(r, S2, AGORA)
  assert.equal(s1.agendadas, 1)
  assert.equal(s1.realizadas, 0)
  assert.equal(s2.agendadas, 0)
  assert.equal(s2.realizadas, 1)
})

test('remarcada não conta duas vezes como agendada', () => {
  // Marcada em 09/10 para 13/10; em 14/10 foi remarcada para 22/10. É o MESMO registro: o
  // que mudou foi `inicio_em`, e `agendada_em` continua sendo o dia em que foi marcada.
  const r = [reuniao({
    inicio_em: '2026-10-22T13:00:00Z', remarcada_em: ['2026-10-14T18:00:00Z'],
    desfecho: null, transcrita: false,
  })]
  const s1 = reunioesDaJanela(r, S1, AGORA)
  const s2 = reunioesDaJanela(r, S2, AGORA)
  assert.equal(s1.agendadas + s2.agendadas, 1)
  assert.equal(s1.agendadas, 1)
  assert.equal(s2.remarcadas, 1)
  assert.equal(s2.realizadas, 0)
})

test('cancelada antes de acontecer: foi agendada, nunca foi realizada', () => {
  const r = [reuniao({ cancelada_em: '2026-10-12T10:00:00Z', desfecho: null, transcrita: false })]
  assert.equal(reuniaoRealizada(r[0]!, AGORA), false)
  // O esforço de marcar aconteceu na semana 1, e continua contando lá.
  assert.equal(reunioesDaJanela(r, S1, AGORA).agendadas, 1)
  const s2 = reunioesDaJanela(r, S2, AGORA)
  assert.equal(s2.canceladas, 1)
  assert.equal(s2.realizadas, 0)
  // Cancelada não é "sem desfecho": o desfecho dela é o cancelamento.
  assert.equal(s2.sem_desfecho, 0)
})

test('no-show: não é realizada, e conta no dia em que foi marcado', () => {
  const r = [reuniao({ desfecho: 'no_show', transcrita: false, no_show_em: ['2026-10-13T14:00:00Z'] })]
  const s2 = reunioesDaJanela(r, S2, AGORA)
  assert.equal(s2.no_shows, 1)
  assert.equal(s2.realizadas, 0)
  assert.equal(s2.sem_desfecho, 0)
})

test('a hora passou e ninguém registrou nada: "sem desfecho", e não realizada', () => {
  const r = [reuniao({ desfecho: null, transcrita: false })]
  const s2 = reunioesDaJanela(r, S2, AGORA)
  assert.equal(s2.realizadas, 0)
  assert.equal(s2.sem_desfecho, 1)
})

test('reunião que ainda não aconteceu não é realizada nem "sem desfecho"', () => {
  const r = reuniao({ desfecho: null, transcrita: false })
  assert.deepEqual(fatosDaReuniao(r, S2, '2026-10-12T09:00:00Z'), [])
})

test('realizada sem transcrição e sem o gravador entra em "sem captura"', () => {
  const sem = [reuniao({ transcrita: false, bot_entrou: false })]
  assert.equal(reunioesDaJanela(sem, S2, AGORA).sem_captura, 1)
  assert.equal(reunioesDaJanela(sem, S2, AGORA).realizadas, 1)
  // O gravador entrou e a transcrição ainda não chegou: houve captura.
  const comBot = [reuniao({ transcrita: false, bot_entrou: true })]
  assert.equal(reunioesDaJanela(comBot, S2, AGORA).sem_captura, 0)
})

test('a transcrição sozinha prova que a reunião aconteceu', () => {
  assert.equal(reuniaoRealizada(reuniao({ desfecho: null, transcrita: true }), AGORA), true)
})
