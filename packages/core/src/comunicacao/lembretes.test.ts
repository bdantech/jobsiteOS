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

test('véspera, dentro da janela: nada ainda — a confirmação é no dia (25/09/2026)', () => {
  const entrega = new Date('2026-09-22T12:00:00Z') // terça, 09:00 BRT
  const reuniao = new Date('2026-09-23T16:00:00Z') // quarta, 13:00 BRT
  assert.equal(tipoDeLembrete(reuniao.getTime() - entrega.getTime(), reuniao, entrega, SP), null)
})

test('menos de 24h mas em OUTRO dia local: ainda não é hora', () => {
  // Vinte horas de distância, e ainda assim "hoje" seria mentira.
  const entrega = new Date('2026-09-21T16:00:00Z') // segunda, 13:00 BRT
  const reuniao = new Date('2026-09-22T12:00:00Z') // terça, 09:00 BRT
  const faltam = reuniao.getTime() - entrega.getTime()
  assert.ok(faltam < h(24) && faltam > h(19))
  assert.equal(tipoDeLembrete(faltam, reuniao, entrega, SP), null)
})

test('véspera à noite: a entrega é na abertura do dia da reunião, e é o D-0', () => {
  const agora = new Date('2026-09-22T21:10:00Z') // terça, 18:10 BRT — janela fechada
  const entrega = new Date('2026-09-23T12:00:00Z') // quarta, 09:00 BRT
  const reuniao = new Date('2026-09-23T17:00:00Z') // quarta, 14:00 BRT
  const criadaEm = new Date('2026-09-20T15:00:00Z')
  assert.equal(
    tipoDeLembrete(reuniao.getTime() - entrega.getTime(), reuniao, entrega, SP, { agora, criadaEm }),
    'd0',
  )
})

test('reunião cedo: a véspera à noite NÃO manda "daqui a pouco" — manda o D-0 das 9h', () => {
  // Entrega às 9h, reunião às 9:30: 30 minutos na entrega. Era H-1, enviado NA HORA
  // (o H-1 fura a janela) — ou seja, na véspera à noite dizendo "é daqui a pouco".
  const agora = new Date('2026-09-22T21:10:00Z') // terça, 18:10 BRT
  const entrega = new Date('2026-09-23T12:00:00Z') // quarta, 09:00 BRT
  const reuniao = new Date('2026-09-23T12:30:00Z') // quarta, 09:30 BRT
  assert.equal(
    tipoDeLembrete(reuniao.getTime() - entrega.getTime(), reuniao, entrega, SP, { agora }),
    'd0',
  )
})

test('reunião marcada no próprio dia não recebe a confirmação de bom dia', () => {
  const agora = new Date('2026-09-23T13:00:00Z') // quarta, 10:00 BRT
  const reuniao = new Date('2026-09-23T19:00:00Z') // quarta, 16:00 BRT
  const criadaEm = new Date('2026-09-23T12:40:00Z') // quarta, 09:40 BRT
  assert.equal(
    tipoDeLembrete(reuniao.getTime() - agora.getTime(), reuniao, agora, SP, { agora, criadaEm }),
    null,
  )
})

test('a uma hora e meia ou menos, com a entrega agora, é H-1', () => {
  const entrega = new Date('2026-09-21T15:00:00Z')
  const reuniao = new Date('2026-09-21T16:00:00Z')
  assert.equal(tipoDeLembrete(reuniao.getTime() - entrega.getTime(), reuniao, entrega, SP), 'h1')
  assert.equal(
    tipoDeLembrete(reuniao.getTime() - entrega.getTime(), reuniao, entrega, SP, { agora: entrega }),
    'h1',
  )
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
