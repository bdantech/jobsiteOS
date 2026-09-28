import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execucaoAnterior } from './expressao.ts'
import { faltasNaAgenda, saudeDaRotina, saudeGeral, type ExecucaoCron } from './saude.ts'

const utc = (iso: string): Date => new Date(`${iso}Z`)

function execucao(parcial: Partial<ExecucaoCron>): ExecucaoCron {
  return {
    path: '/api/cron/x',
    status: 'concluida',
    iniciado_em: '2026-09-28T10:00:30Z',
    terminado_em: null,
    esperado_em: null,
    acompanhado: true,
    erro: null,
    ...parcial,
  }
}

test('execucaoAnterior: o próprio minuto conta, e o anterior vem antes', () => {
  assert.deepEqual(execucaoAnterior('0 10 * * 1', utc('2026-09-28T10:00:40')), utc('2026-09-28T10:00:00'))
  // Segunda 09:59 → a segunda anterior.
  assert.deepEqual(execucaoAnterior('0 10 * * 1', utc('2026-09-28T09:59:00')), utc('2026-09-21T10:00:00'))
  assert.deepEqual(execucaoAnterior('*/5 * * * *', utc('2026-09-28T10:17:12')), utc('2026-09-28T10:15:00'))
  // Mensal: dia 10 do mês passado.
  assert.deepEqual(execucaoAnterior('0 6 10 * *', utc('2026-09-09T12:00:00')), utc('2026-08-10T06:00:00'))
  // Vira o ano.
  assert.deepEqual(execucaoAnterior('0 9 1 * *', utc('2026-01-01T08:00:00')), utc('2025-12-01T09:00:00'))
})

test('saudeDaRotina: falha e falta são vermelhas; sem registro e pulada, amarelas', () => {
  const agora = utc('2026-09-28T12:00:00')
  assert.equal(saudeDaRotina(null, agora).cor, 'amarela')
  assert.equal(saudeDaRotina(execucao({ status: 'falhou' }), agora).cor, 'vermelha')
  assert.equal(saudeDaRotina(execucao({ status: 'nao_executou' }), agora).cor, 'vermelha')
  assert.equal(saudeDaRotina(execucao({ status: 'pulada' }), agora).cor, 'amarela')
  assert.deepEqual(saudeDaRotina(execucao({}), agora), { cor: 'verde', rotulo: 'Rodou' })
  // Sem acompanhamento do worker, a tela não promete que o job terminou.
  assert.deepEqual(saudeDaRotina(execucao({ acompanhado: false }), agora), { cor: 'verde', rotulo: 'Disparada' })
})

test('saudeDaRotina: rodando é normal até o limite, e perdido depois dele', () => {
  const rodando = execucao({ status: 'executando', iniciado_em: '2026-09-28T10:00:00Z' })
  assert.equal(saudeDaRotina(rodando, utc('2026-09-28T12:00:00')).cor, 'verde')
  assert.equal(saudeDaRotina(rodando, utc('2026-09-28T17:00:00')).cor, 'vermelha')
  // A Receita tem limite próprio.
  assert.equal(saudeDaRotina(rodando, utc('2026-09-28T17:00:00'), 24).cor, 'verde')
})

test('saudeGeral: a pior cor manda', () => {
  assert.equal(saudeGeral(['verde', 'verde']), 'verde')
  assert.equal(saudeGeral(['verde', 'amarela']), 'amarela')
  assert.equal(saudeGeral(['amarela', 'vermelha', 'verde']), 'vermelha')
  assert.equal(saudeGeral([]), 'verde')
})

test('faltasNaAgenda: a segunda de 28/09 — distribuição sem disparo vira falta', () => {
  const agendados = [
    { path: '/api/cron/comercial-distribuir', schedule: '0 10 * * 1' },
    { path: '/api/cron/leads-enriquecer', schedule: '*/5 * * * *' },
  ]
  const ultimos = new Map([
    // A última distribuição registrada é da semana anterior.
    ['/api/cron/comercial-distribuir', utc('2026-09-21T10:00:33')],
    ['/api/cron/leads-enriquecer', utc('2026-09-28T10:05:01')],
  ])
  const faltas = faltasNaAgenda(agendados, ultimos, utc('2026-09-28T10:12:00'), utc('2026-09-01T00:00:00'))
  assert.deepEqual(faltas, [{ path: '/api/cron/comercial-distribuir', esperado_em: utc('2026-09-28T10:00:00') }])
})

test('faltasNaAgenda: dentro da folga ainda não é falta', () => {
  const agendados = [{ path: '/api/cron/comercial-distribuir', schedule: '0 10 * * 1' }]
  const ultimos = new Map([['/api/cron/comercial-distribuir', utc('2026-09-21T10:00:33')]])
  // 10:05: o horário das 10:00 ainda está na folga de 10 minutos; o anterior (21/09) rodou.
  assert.deepEqual(faltasNaAgenda(agendados, ultimos, utc('2026-09-28T10:05:00'), utc('2026-09-01T00:00:00')), [])
})

test('faltasNaAgenda: antes do início do monitoramento não se acusa nada', () => {
  const agendados = [{ path: '/api/cron/mercado-receita', schedule: '0 6 10 * *' }]
  // Nunca registrou disparo, mas o dia 10 foi antes de a tabela existir.
  assert.deepEqual(faltasNaAgenda(agendados, new Map(), utc('2026-09-28T12:00:00'), utc('2026-09-28T11:00:00')), [])
})

test('faltasNaAgenda: rotina sem disparo nenhum depois do início é falta', () => {
  const agendados = [{ path: '/api/cron/heartbeat', schedule: '0 8 * * *' }]
  const faltas = faltasNaAgenda(agendados, new Map(), utc('2026-09-29T09:00:00'), utc('2026-09-28T19:00:00'))
  assert.deepEqual(faltas, [{ path: '/api/cron/heartbeat', esperado_em: utc('2026-09-29T08:00:00') }])
})

test('faltasNaAgenda: expressão inválida é ignorada, não derruba o monitor', () => {
  const agendados = [{ path: '/api/cron/quebrado', schedule: '0 99 * * *' }]
  assert.deepEqual(faltasNaAgenda(agendados, new Map(), utc('2026-09-28T12:00:00'), utc('2026-09-01T00:00:00')), [])
})
