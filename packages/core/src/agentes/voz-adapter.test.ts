import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  desfechoEstruturado,
  statusDaResposta,
  traduzirPedido,
  versaoDaResposta,
  type ContextoLigacao,
} from './voz-adapter.ts'

const CTX: ContextoLigacao = {
  id_externo: 'MDT-2026-00001:1',
  objetivo: 'agendar_reuniao',
  contato: { id: 'c1', nome: 'Carlos Menezes', cargo: 'Financeiro', telefone_e164: '+5511988887777' },
  empresa: { razao_social: 'Construtora X', cnpj: '11222333000144' },
  persona: { nome: 'Ana', voz_conta_id: 'ana-01' },
  motivo: 'A Marcia indicou o Carlos como quem decide antecipação.',
  janelas: [{ id: 'r1', inicio: '2026-09-30T13:00:00Z', fim: '2026-09-30T13:30:00Z' }],
}

test('objetivo não suportado pela v1 é RECUSADO com erro claro, nunca traduzido', () => {
  const t = traduzirPedido('v1', CTX)
  assert.equal(t.ok, false)
  if (!t.ok) {
    assert.equal(t.codigo, 'objetivo_nao_suportado')
    assert.match(t.erro, /WhatsApp ou e-mail/)
  }
  // "desconhecida" degrada como v1.
  assert.equal(traduzirPedido('desconhecida', CTX).ok, false)
})

test('v1 com oferta de NF passa o pedido v1 intacto, com o id e o telefone da ligação', () => {
  const pedido = { id_externo: 'x', telefone: '+5511000000000', oferta: { resumo: 1 } } as never
  const t = traduzirPedido('v1', { ...CTX, objetivo: 'ofertar_antecipacao', pedido_v1: pedido })
  assert.ok(t.ok)
  if (t.ok) {
    assert.equal(t.versao, 'v1')
    assert.equal(t.payload.id_externo, 'MDT-2026-00001:1')
    assert.equal(t.payload.telefone, '+5511988887777')
  }
})

test('v2 manda objetivo, briefing e o conjunto FECHADO de janelas', () => {
  const t = traduzirPedido('v2', CTX)
  assert.ok(t.ok)
  if (t.ok) {
    assert.equal(t.payload.versao, '2')
    assert.equal(t.payload.objetivo, 'agendar_reuniao')
    assert.deepEqual(t.payload.janelas, CTX.janelas)
  }
  // Agendar sem janela: recusa — a Ana nunca inventa horário.
  const sem = traduzirPedido('v2', { ...CTX, janelas: [] })
  assert.equal(sem.ok, false)
})

test('agendar_retorno com contato NOVO vira retorno + contato a registrar', () => {
  const d = desfechoEstruturado({
    outcome: 'agendar_retorno',
    desfecho: {
      tipo: 'agendar_retorno',
      quando: '2026-10-01T18:30:00-03:00',
      contato: { nome: 'Carlos Menezes', telefone: '(11) 98888-7777', cargo: 'Diretor financeiro' },
    },
  })
  assert.equal(d.tipo, 'agendar_retorno')
  if (d.tipo === 'agendar_retorno') {
    assert.equal(d.quando, '2026-10-01T18:30:00-03:00')
    assert.deepEqual(d.contato, {
      nome: 'Carlos Menezes',
      cargo: 'Diretor financeiro',
      telefone_e164: '+5511988887777',
      email: null,
    })
  }
})

test('indicou_outro_contato vira contato novo; da v1, o `decisor` da chamada também serve', () => {
  const v2 = desfechoEstruturado({ desfecho: { tipo: 'indicou_outro_contato', contato: { nome: 'Carlos', email: 'carlos@x.com.br' } } })
  assert.equal(v2.tipo, 'indicou_outro_contato')

  const v1 = desfechoEstruturado({
    outcome: 'pessoa_errada',
    chamada: { decisor: { nome: 'Carlos', telefone: '11988887777' }, resumo: 'Marcia é do RH.' },
  })
  assert.equal(v1.tipo, 'indicou_outro_contato')
  if (v1.tipo === 'indicou_outro_contato') assert.equal(v1.contato.telefone_e164, '+5511988887777')

  // Sem nome ou sem meio de contato não há o que registrar.
  assert.equal(desfechoEstruturado({ outcome: 'pessoa_errada', chamada: { decisor: { nome: 'Carlos' } } }).tipo, 'nenhum')
})

test('versão da Ana: 404 é v1, {versao: "2"} é v2, erro é desconhecida', () => {
  assert.equal(versaoDaResposta(404, null), 'v1')
  assert.equal(versaoDaResposta(200, { versao: '2.1' }), 'v2')
  assert.equal(versaoDaResposta(200, { versao: '1' }), 'v1')
  assert.equal(versaoDaResposta(503, null), 'desconhecida')
})

test('v2 leva a política de identificação; sem ela, o padrão se_perguntada', () => {
  const com = traduzirPedido('v2', { ...CTX, identificacao: 'sempre' })
  assert.ok(com.ok)
  if (com.ok) assert.equal(com.payload.identificacao, 'sempre')
  const sem = traduzirPedido('v2', CTX)
  assert.ok(sem.ok)
  if (sem.ok) assert.equal(sem.payload.identificacao, 'se_perguntada')
})

test('v2 que anuncia objetivos só recebe os anunciados', () => {
  const t = traduzirPedido('v2', CTX, ['ofertar_antecipacao'])
  assert.equal(t.ok, false)
  if (!t.ok) assert.equal(t.codigo, 'objetivo_nao_suportado')
  assert.ok(traduzirPedido('v2', CTX, ['ofertar_antecipacao', 'agendar_reuniao']).ok)
  // Sem lista: a v2 aceita os quatro.
  assert.ok(traduzirPedido('v2', CTX, null).ok)
})

test('status da Ana: a lista de objetivos só vale na v2 e só com nomes conhecidos', () => {
  assert.deepEqual(statusDaResposta(200, { versao: '2', objetivos: ['agendar_reuniao', 'dancar'] }), {
    versao: 'v2',
    objetivos: ['agendar_reuniao'],
  })
  assert.deepEqual(statusDaResposta(200, { versao: '2' }), { versao: 'v2', objetivos: null })
  assert.deepEqual(statusDaResposta(200, { versao: '2', objetivos: [] }), { versao: 'v2', objetivos: null })
  assert.deepEqual(statusDaResposta(404, null), { versao: 'v1', objetivos: null })
})

test('qualificação e reativação chegam estruturadas', () => {
  const q = desfechoEstruturado({
    desfecho: {
      tipo: 'qualificacao',
      fit: 'Não',
      volume_mensal_brl: '250000',
      sacados: ['MRV', '', 'Cyrela'],
      decisor: { nome: 'Carlos', telefone: '(11) 98888-7777' },
    },
  })
  assert.equal(q.tipo, 'qualificacao')
  if (q.tipo === 'qualificacao') {
    assert.equal(q.fit, 'nao')
    assert.equal(q.volume_mensal_brl, 250000)
    assert.deepEqual(q.sacados, ['MRV', 'Cyrela'])
    assert.equal(q.decisor?.telefone_e164, '+5511988887777')
  }
  const r = desfechoEstruturado({ desfecho: { tipo: 'reativacao', quer_voltar: 'talvez', motivo_saida: 'taxa' } })
  assert.deepEqual(r, { tipo: 'reativacao', motivo_saida: 'taxa', quer_voltar: 'talvez', observacao: null })
})
