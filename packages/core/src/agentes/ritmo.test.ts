import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deveDormirSemNovidade, proximaAcaoDoMandato } from './ritmo.ts'
import type { PlanoMandato } from './schemas.ts'

// 2026-10-05 é uma segunda-feira; 13h UTC = 10h em São Paulo.
const AGORA = new Date('2026-10-05T13:00:00Z')
const GERAL = { espera_maxima_min: 10, intervalo_ciclo_min: 5, espera_sem_novidade_max_min: 120 }
const LONGE = new Date('2026-10-20T13:00:00Z')

const plano = (item: Partial<PlanoMandato['proximas_acoes'][number]>): PlanoMandato => ({
  objetivo_atual: 'Ofertar a antecipação',
  proximas_acoes: [{ acao: 'ligar', quando: '2026-10-06T10:00:00-03:00', por_que: 'teste', ...item }],
  bloqueios: [],
  confianca: 0.5,
})

const min = (d: Date) => Math.round((d.getTime() - AGORA.getTime()) / 60_000)

test('sem pedido do cliente, "amanhã às 10h" vira daqui a 10 minutos', () => {
  const r = proximaAcaoDoMandato({ agora: AGORA, plano: plano({}), marcado: null, expiraEm: LONGE, geral: GERAL })
  assert.equal(min(r.em), 10)
  assert.equal(r.motivo, 'teto_de_espera')
})

test('com pedido do cliente, o horário dele vale', () => {
  const r = proximaAcaoDoMandato({
    agora: AGORA,
    plano: plano({ pedido_do_cliente: 'me liga amanhã às 10h' }),
    marcado: null,
    expiraEm: LONGE,
    geral: GERAL,
  })
  assert.equal(r.em.toISOString(), '2026-10-06T13:00:00.000Z')
  assert.equal(r.motivo, 'pedido_do_cliente')
})

test('plano dentro do teto vale como está, sem ficar abaixo do intervalo mínimo', () => {
  const daqui7 = new Date(AGORA.getTime() + 7 * 60_000).toISOString()
  assert.equal(min(proximaAcaoDoMandato({ agora: AGORA, plano: plano({ quando: daqui7 }), marcado: null, expiraEm: LONGE, geral: GERAL }).em), 7)
  const daqui1 = new Date(AGORA.getTime() + 60_000).toISOString()
  assert.equal(min(proximaAcaoDoMandato({ agora: AGORA, plano: plano({ quando: daqui1 }), marcado: null, expiraEm: LONGE, geral: GERAL }).em), 5)
})

test('sem plano: o teto', () => {
  assert.equal(min(proximaAcaoDoMandato({ agora: AGORA, plano: null, marcado: null, expiraEm: LONGE, geral: GERAL }).em), 10)
})

test('nunca depois da validade, nem com pedido do cliente', () => {
  const expira = new Date(AGORA.getTime() + 60 * 60_000)
  const r = proximaAcaoDoMandato({
    agora: AGORA,
    plano: plano({ pedido_do_cliente: 'semana que vem' }),
    marcado: null,
    expiraEm: expira,
    geral: GERAL,
  })
  assert.equal(r.motivo, 'validade')
  assert.equal(min(r.em), 55)
})

test('esperando resposta sem novidade: dorme até a janela de paciência acabar', () => {
  const esperando = plano({ aguarda: 'resposta' })
  const ha30 = new Date(AGORA.getTime() - 30 * 60_000)
  const ha3h = new Date(AGORA.getTime() - 180 * 60_000)
  assert.equal(deveDormirSemNovidade({ agora: AGORA, plano: esperando, ultimoCicloEm: ha30, houveNovidade: false, geral: GERAL }), true)
  assert.equal(deveDormirSemNovidade({ agora: AGORA, plano: esperando, ultimoCicloEm: ha3h, houveNovidade: false, geral: GERAL }), false)
  // Novidade acorda o modelo; plano que não é espera também.
  assert.equal(deveDormirSemNovidade({ agora: AGORA, plano: esperando, ultimoCicloEm: ha30, houveNovidade: true, geral: GERAL }), false)
  assert.equal(deveDormirSemNovidade({ agora: AGORA, plano: plano({}), ultimoCicloEm: ha30, houveNovidade: false, geral: GERAL }), false)
})
