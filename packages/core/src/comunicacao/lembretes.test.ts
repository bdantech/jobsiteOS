import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tipoDeLembrete } from './lembretes.ts'

/**
 * A regra é uma só: o lembrete é escrito para a hora em que vai ser ENTREGUE.
 *
 * O caso real que originou isto — um D-1 gerado no domingo de manhã dizendo
 * "nossa conversa amanhã, 21/09" e entregue na segunda às 9h, quando a reunião
 * estava a uma hora — não quebra typecheck nem teste de envio. Ele só aparece
 * como uma mensagem que mente para o cliente.
 */

const SP = 'America/Sao_Paulo'
const h = (n: number): number => n * 3_600_000

test('domingo: o D-1 que só chega na segunda vira D-0, e não diz "amanhã"', () => {
  // Gerado domingo 09:10 BRT. A janela é seg–sex, então a entrega é segunda 09:00.
  const entrega = new Date('2026-09-21T12:00:00Z') // segunda, 09:00 BRT
  const reuniao = new Date('2026-09-21T16:00:00Z') // segunda, 13:00 BRT
  assert.equal(tipoDeLembrete(reuniao.getTime() - entrega.getTime(), reuniao, entrega, SP), 'd0')
})

test('véspera de dia útil segue sendo D-1', () => {
  const entrega = new Date('2026-09-22T12:00:00Z') // terça, 09:00 BRT
  const reuniao = new Date('2026-09-23T16:00:00Z') // quarta, 13:00 BRT
  assert.equal(tipoDeLembrete(reuniao.getTime() - entrega.getTime(), reuniao, entrega, SP), 'd1')
})

test('menos de 24h mas em OUTRO dia local continua D-1', () => {
  // Vinte horas de distância, e ainda assim "hoje" seria mentira.
  const entrega = new Date('2026-09-21T16:00:00Z') // segunda, 13:00 BRT
  const reuniao = new Date('2026-09-22T12:00:00Z') // terça, 09:00 BRT
  const faltam = reuniao.getTime() - entrega.getTime()
  assert.ok(faltam < h(24) && faltam > h(19))
  assert.equal(tipoDeLembrete(faltam, reuniao, entrega, SP), 'd1')
})

test('a uma hora e meia ou menos, é H-1', () => {
  const entrega = new Date('2026-09-21T15:00:00Z')
  const reuniao = new Date('2026-09-21T16:00:00Z')
  assert.equal(tipoDeLembrete(reuniao.getTime() - entrega.getTime(), reuniao, entrega, SP), 'h1')
})

test('reunião distante ainda não tem lembrete', () => {
  const entrega = new Date('2026-09-21T12:00:00Z')
  const reuniao = new Date('2026-09-24T16:00:00Z')
  assert.equal(tipoDeLembrete(reuniao.getTime() - entrega.getTime(), reuniao, entrega, SP), null)
})

test('reunião que já começou na hora da entrega não gera lembrete', () => {
  // Sexta 17h, cujo lembrete só abriria na segunda: chegaria depois da conversa.
  const entrega = new Date('2026-09-21T12:00:00Z') // segunda, 09:00 BRT
  const reuniao = new Date('2026-09-18T20:00:00Z') // sexta, 17:00 BRT
  assert.equal(tipoDeLembrete(reuniao.getTime() - entrega.getTime(), reuniao, entrega, SP), null)
})

test('a virada do dia é a LOCAL, não a UTC', () => {
  // 21/09 22:00 BRT = 22/09 01:00 UTC. Para quem lê em São Paulo os dois
  // instantes abaixo são o MESMO dia — em UTC, um deles já é o dia seguinte.
  const entrega = new Date('2026-09-22T01:00:00Z') // 21/09, 22:00 BRT
  const reuniao = new Date('2026-09-22T02:30:00Z') // 21/09, 23:30 BRT
  assert.equal(tipoDeLembrete(h(10), reuniao, entrega, SP), 'd0')
})
