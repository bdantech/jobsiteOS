import assert from 'node:assert/strict'
import test from 'node:test'

import {
  agregadoDeAquisicao,
  aquisicaoPorMes,
  carimboDaAquisicao,
  fitDoLead,
  matrizDeLeads,
  matrizDoBloco,
  origemDoLead,
  serieDeAquisicao,
  temSemOrigem,
  totalDoBloco,
  type BlocoAquisicao,
  type LeadAquisicao,
  type LinhaAquisicao,
} from './aquisicao.js'

const SEMANA = { inicio: '2026-10-05', fim: '2026-10-11' }

const lead = (p: Partial<LeadAquisicao> = {}): LeadAquisicao => ({
  origem: 'inbound', fit: null, distribuido_em: '2026-10-07T14:00:00Z', ...p,
})

const linha = (p: Partial<LinhaAquisicao> = {}): LinhaAquisicao => ({
  origem: 'inbound', com_fit: 0, sem_fit: 0, nao_avaliado: 0, expirados_sem_avaliar: 0,
  agendadas: 0, realizadas: 0, canceladas: 0, remarcadas: 0, no_shows: 0,
  sem_captura: 0, sem_desfecho: 0, ...p,
})

const bloco = (p: Partial<BlocoAquisicao> = {}): BlocoAquisicao => ({
  ...SEMANA, em_aberto: false, calculado_em: '2026-10-12T12:00:00Z',
  origens: [linha(), linha({ origem: 'outbound' })], ...p,
})

// ─── A classificação ────────────────────────────────────────────────────────

test('outbound é tudo que não é inbound — distribuição e manual', () => {
  assert.equal(origemDoLead('inbound'), 'inbound')
  assert.equal(origemDoLead('distribuicao'), 'outbound')
  assert.equal(origemDoLead('manual'), 'outbound')
})

test('lead sem origem vira "Sem origem", e não é distribuído por chute', () => {
  assert.equal(origemDoLead(null), 'sem_origem')
  assert.equal(origemDoLead(''), 'sem_origem')
  const m = matrizDeLeads([lead({ origem: null, fit: true }), lead({ origem: 'inbound' })], SEMANA)
  assert.equal(m.sem_origem.com_fit, 1)
  assert.equal(m.inbound.com_fit + m.outbound.com_fit, 0)
})

test('lead sem avaliação de fit é "ainda não avaliado" — NUNCA "sem fit"', () => {
  assert.equal(fitDoLead(null), 'nao_avaliado')
  assert.equal(fitDoLead(undefined), 'nao_avaliado')
  assert.equal(fitDoLead(false), 'sem_fit')
  const m = matrizDeLeads([lead(), lead(), lead({ fit: false })], SEMANA)
  assert.deepEqual(m.inbound, { com_fit: 0, sem_fit: 1, nao_avaliado: 2 })
})

test('lead avaliado DEPOIS da semana em que entrou conta na semana de entrada', () => {
  // Entrou em 07/10 (semana 41) e teve o fit definido na semana 43. A data da avaliação
  // nem é argumento da função: ela não tem como decidir a semana.
  const l = lead({ fit: true, distribuido_em: '2026-10-07T14:00:00Z' })
  assert.equal(matrizDeLeads([l], SEMANA).inbound.com_fit, 1)
  assert.equal(matrizDeLeads([l], { inicio: '2026-10-19', fim: '2026-10-25' }).inbound.com_fit, 0)
})

test('semana sem nenhum lead dá a matriz zerada, e os percentuais são null', () => {
  const m = matrizDeLeads([], SEMANA)
  assert.deepEqual(m.inbound, { com_fit: 0, sem_fit: 0, nao_avaliado: 0 })
  const linhas = matrizDoBloco(bloco())
  assert.equal(linhas.at(-1)?.origem, 'total')
  assert.equal(linhas.at(-1)?.total, 0)
  // 0 de 0 não é 0%: "não há o que medir" e "ninguém teve fit" são leituras opostas.
  assert.equal(linhas[0]?.pct.com_fit, null)
})

test('o lead entra pela data em São Paulo, não em UTC', () => {
  // Domingo 11/10 às 22h de São Paulo já é segunda em UTC — e ainda é da semana 41.
  const l = lead({ distribuido_em: '2026-10-12T01:00:00Z' })
  assert.equal(matrizDeLeads([l], SEMANA).inbound.nao_avaliado, 1)
})

// ─── A grade ────────────────────────────────────────────────────────────────

test('a matriz traz contagem absoluta e percentual DA LINHA', () => {
  const b = bloco({
    origens: [
      linha({ com_fit: 1, sem_fit: 19, nao_avaliado: 25 }),
      linha({ origem: 'outbound', com_fit: 3, sem_fit: 4, nao_avaliado: 46 }),
    ],
  })
  const [inb, out, tot] = matrizDoBloco(b)
  assert.equal(inb?.total, 45)
  assert.equal(inb?.pct.sem_fit, 42.2)
  assert.equal(out?.total, 53)
  assert.equal(tot?.total, 98)
  assert.equal(tot?.com_fit, 4)
  assert.equal(tot?.pct.nao_avaliado, 72.4)
})

test('"Sem origem" só é sinalizada quando existe', () => {
  assert.equal(temSemOrigem(bloco()), false)
  assert.equal(temSemOrigem(bloco({ origens: [linha({ origem: 'sem_origem', nao_avaliado: 2 })] })), true)
})

test('o total soma as reuniões das origens', () => {
  const t = totalDoBloco(bloco({
    origens: [linha({ agendadas: 9, realizadas: 12 }), linha({ origem: 'outbound', agendadas: 3, realizadas: 1 })],
  }))
  assert.equal(t.agendadas, 12)
  assert.equal(t.realizadas, 13)
})

// ─── As duas vidas do report ────────────────────────────────────────────────

test('na tela o carimbo diz "atualizado agora"; no PDF, "dados de dd/mm às HH:MM"', () => {
  // 12/10/2026 12:00 UTC = 09:00 em São Paulo.
  const b = bloco({ calculado_em: '2026-10-12T12:00:00Z' })
  assert.equal(carimboDaAquisicao(b, true), 'atualizado agora, às 09:00')
  assert.equal(carimboDaAquisicao(b, false), 'dados de 12/10 às 09:00')
})

// ─── A série ────────────────────────────────────────────────────────────────

const serie: BlocoAquisicao[] = [
  bloco({ inicio: '2026-10-12', fim: '2026-10-18', em_aberto: true, origens: [linha({ nao_avaliado: 500, agendadas: 40 })] }),
  bloco({ origens: [linha({ com_fit: 2, sem_fit: 8, agendadas: 9, realizadas: 12 })] }),
  bloco({ inicio: '2026-09-28', fim: '2026-10-04', origens: [linha({ com_fit: 4, sem_fit: 6, agendadas: 11, realizadas: 8 })] }),
]

test('a semana em aberto não entra na média nem no total da Aquisição', () => {
  const leads = agregadoDeAquisicao(serie, 'total_leads')
  assert.equal(leads.total, 20)
  assert.equal(leads.media, 10)
  assert.equal(leads.semanas, 2)
  assert.equal(agregadoDeAquisicao(serie, 'agendadas').total, 20)
})

test('o agregado mensal ignora a semana em aberto', () => {
  const [out] = aquisicaoPorMes(serie)
  assert.equal(out?.mes, '2026-10')
  assert.equal(out?.semanas, 2)
  assert.equal(out?.com_fit, 6)
  assert.equal(out?.nao_avaliado, 0)
})

test('os pontos do gráfico vão do mais antigo ao mais recente, com a em aberto marcada', () => {
  const p = serieDeAquisicao(serie)
  assert.deepEqual(p.map((x) => x.inicio), ['2026-09-28', '2026-10-05', '2026-10-12'])
  assert.equal(p[0]?.inbound_com_fit, 4)
  assert.equal(p.at(-1)?.em_aberto, true)
})
