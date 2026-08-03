import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CronError, descreverCron, parseCron, proximaExecucao } from './expressao.ts'
import { CRONS, listarCrons } from './catalogo.ts'

const utc = (iso: string): Date => new Date(`${iso}Z`)

test('parseCron: campos simples, listas, faixas e passos', () => {
  assert.deepEqual(parseCron('0 8 * * *'), {
    minutos: [0],
    horas: [8],
    diasDoMes: null,
    meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    diasDaSemana: null,
  })

  assert.deepEqual(parseCron('30 9,13,17,21,1,5 * * *').horas, [1, 5, 9, 13, 17, 21])
  assert.deepEqual(parseCron('0 0 * * 1-5').diasDaSemana, [1, 2, 3, 4, 5])
  assert.deepEqual(parseCron('*/15 * * * *').minutos, [0, 15, 30, 45])
  // Domingo escrito como 7 vira 0, que é o que getUTCDay() devolve.
  assert.deepEqual(parseCron('0 0 * * 7').diasDaSemana, [0])
})

test('parseCron: recusa o que não entende em vez de adivinhar', () => {
  assert.throws(() => parseCron('0 8 * *'), CronError)
  assert.throws(() => parseCron('0 99 * * *'), CronError)
  assert.throws(() => parseCron('0 8 32 * *'), CronError)
})

test('proximaExecucao: diário, hoje ou amanhã conforme a hora', () => {
  assert.deepEqual(proximaExecucao('0 8 * * *', utc('2026-08-03T07:59:00')), utc('2026-08-03T08:00:00'))
  // Em cima da hora não conta: a próxima é ESTRITAMENTE depois de agora.
  assert.deepEqual(proximaExecucao('0 8 * * *', utc('2026-08-03T08:00:00')), utc('2026-08-04T08:00:00'))
})

test('proximaExecucao: mensal atravessa o mês e o ano', () => {
  assert.deepEqual(proximaExecucao('0 6 10 * *', utc('2026-08-03T12:00:00')), utc('2026-08-10T06:00:00'))
  assert.deepEqual(proximaExecucao('0 6 10 * *', utc('2026-08-10T06:01:00')), utc('2026-09-10T06:00:00'))
  assert.deepEqual(proximaExecucao('0 6 10 * *', utc('2026-12-31T23:00:00')), utc('2027-01-10T06:00:00'))
})

test('proximaExecucao: dia 31 pula os meses que não o têm', () => {
  assert.deepEqual(proximaExecucao('0 0 31 * *', utc('2026-09-15T00:00:00')), utc('2026-10-31T00:00:00'))
})

test('proximaExecucao: a cada 4 horas pega o próximo horário do dia', () => {
  const expr = '30 9,13,17,21,1,5 * * *'
  assert.deepEqual(proximaExecucao(expr, utc('2026-08-03T09:31:00')), utc('2026-08-03T13:30:00'))
  assert.deepEqual(proximaExecucao(expr, utc('2026-08-03T21:31:00')), utc('2026-08-04T01:30:00'))
})

test('proximaExecucao: expressão impossível devolve null em vez de travar', () => {
  assert.equal(proximaExecucao('0 0 30 2 *', utc('2026-08-03T00:00:00')), null)
})

test('descreverCron: traduz e converte para Brasília', () => {
  const mensal = descreverCron('0 6 10 * *')
  assert.equal(mensal.cadencia, 'mensal')
  assert.equal(mensal.periodicidade, 'Todo dia 10')
  assert.deepEqual(mensal.horariosUtc, ['06:00'])
  assert.deepEqual(mensal.horariosBrasilia, ['03:00'])
  assert.equal(mensal.viraDia, false)

  const sync = descreverCron('30 9,13,17,21,1,5 * * *')
  assert.equal(sync.cadencia, 'diaria')
  assert.equal(sync.periodicidade, 'Todo dia')
  assert.deepEqual(sync.horariosBrasilia, ['22:30', '02:30', '06:30', '10:30', '14:30', '18:30'])
  // 01:30 UTC é 22:30 do dia ANTERIOR em Brasília. A tela precisa saber para não mentir.
  assert.equal(sync.viraDia, true)

  assert.equal(descreverCron('0 12 * * 1').periodicidade, 'Toda segunda-feira')
})

test('listarCrons: ordena pela próxima execução e denuncia divergência', () => {
  const agora = utc('2026-08-03T12:00:00')
  const lista = listarCrons(
    [
      { path: '/api/cron/mercado-receita', schedule: '0 6 10 * *' },
      { path: '/api/cron/heartbeat', schedule: '0 8 * * *' },
      { path: '/api/cron/inventado', schedule: '0 9 * * *' },
    ],
    agora,
  )

  // Heartbeat (amanhã 08:00) antes do dump (dia 10); o não catalogado aparece assim mesmo.
  assert.deepEqual(
    lista.map((c) => c.path),
    [
      '/api/cron/heartbeat',
      '/api/cron/inventado',
      '/api/cron/mercado-receita',
      // Todo o resto do catálogo ficou sem agenda nesta chamada: vem no fim, marcado.
      ...CRONS.filter(
        (c) => !['/api/cron/mercado-receita', '/api/cron/heartbeat'].includes(c.path),
      )
        .map((c) => c.path)
        .sort((a, b) => {
          const nome = (p: string) => CRONS.find((c) => c.path === p)!.nome
          return nome(a).localeCompare(nome(b), 'pt-BR')
        }),
    ],
  )

  assert.equal(lista.find((c) => c.path === '/api/cron/inventado')?.semCatalogo, true)
  assert.equal(lista.find((c) => c.path === '/api/cron/credito-sync')?.naoAgendado, true)
})

test('listarCrons: expressão inválida não derruba a lista', () => {
  const lista = listarCrons([{ path: '/api/cron/heartbeat', schedule: 'todo dia' }], utc('2026-08-03T12:00:00'))
  const heartbeat = lista.find((c) => c.path === '/api/cron/heartbeat')
  assert.ok(heartbeat?.erro)
  assert.equal(heartbeat?.proxima, null)
})

test('o catálogo não tem path duplicado', () => {
  assert.equal(new Set(CRONS.map((c) => c.path)).size, CRONS.length)
})
