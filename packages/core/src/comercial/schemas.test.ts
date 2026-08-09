import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aceitaGestaoOperacao,
  definirCarteiraPassivaSchema,
  efeitoDaDecisaoCredito,
  leadEstaVivo,
  vendaNoFunil,
} from './schemas.ts'

/**
 * O vocabulário do módulo — as regras que decidem quem aparece em qual tela e quem
 * recebe por quê.
 *
 * Cada uma destas tem uma versão errada plausível, e é a versão errada que estes testes
 * existem para barrar: gestão como atributo universal, ganho como saída do funil, e a
 * decisão parcial de crédito movendo o card sozinha.
 */

// ─── Gestão da operação é assunto de cliente ────────────────────────────────

test('só cliente e ex-cliente respondem a ativo × passivo', () => {
  assert.equal(aceitaGestaoOperacao({ estagio: 'cliente' }), true)
  assert.equal(aceitaGestaoOperacao({ estagio: 'ex_cliente' }), true)
})

test('empresa de mercado não responde — a pergunta pressupõe quem antecipa', () => {
  for (const estagio of ['mercado', 'lead', 'prospect']) {
    assert.equal(aceitaGestaoOperacao({ estagio }), false, estagio)
  }
})

test('estágio ausente é "não", não "talvez"', () => {
  // Um `undefined` chega aqui quando a consulta não trouxe a coluna. Cair no permissivo
  // ofereceria o botão numa tela que não sabe do que está falando, e o banco recusaria.
  assert.equal(aceitaGestaoOperacao({}), false)
  assert.equal(aceitaGestaoOperacao({ estagio: null }), false)
})

// ─── Carteira passiva: conjunto, não delta ──────────────────────────────────

test('a carteira passiva aceita lista vazia — é assim que se esvazia', () => {
  const r = definirCarteiraPassivaSchema.parse({
    vendedor_id: '11111111-1111-4111-8111-111111111111',
    empresa_ids: [],
  })
  assert.deepEqual(r.empresa_ids, [])
})

test('omitir empresa_ids também esvazia, em vez de virar undefined', () => {
  const r = definirCarteiraPassivaSchema.parse({
    vendedor_id: '11111111-1111-4111-8111-111111111111',
  })
  assert.deepEqual(r.empresa_ids, [])
})

test('id que não é uuid é recusado antes de virar consulta', () => {
  assert.throws(() =>
    definirCarteiraPassivaSchema.parse({
      vendedor_id: '11111111-1111-4111-8111-111111111111',
      empresa_ids: ['nao-e-uuid'],
    }),
  )
})

// ─── O que continua no funil ────────────────────────────────────────────────

test('ganho sem primeira operação CONTINUA no funil', () => {
  // É o caso que motivou separar situação de estágio: ganho em onboarding ainda é
  // trabalho, e é aí que um negócio fechado morre por falta de acompanhamento.
  assert.equal(vendaNoFunil({ situacao: 'ganho', primeira_operacao_em: null }), true)
})

test('ganho que já operou sai — rotina não mora em funil', () => {
  assert.equal(
    vendaNoFunil({ situacao: 'ganho', primeira_operacao_em: '2026-08-01T12:00:00Z' }),
    false,
  )
})

test('perdido sai mesmo sem operação nenhuma', () => {
  assert.equal(vendaNoFunil({ situacao: 'perdido', primeira_operacao_em: null }), false)
})

test('lead qualificado não é carga do SDR — ele cumpriu o funil', () => {
  assert.equal(leadEstaVivo({ estagio: 'qualificada' }), false)
  assert.equal(leadEstaVivo({ estagio: 'em_conversa' }), true)
  assert.equal(leadEstaVivo({ estagio: 'em_conversa', encerrado_em: '2026-08-01' }), false)
})

// ─── A decisão da seguradora ────────────────────────────────────────────────

test('aprovada move o estágio; negada muda a situação', () => {
  assert.deepEqual(efeitoDaDecisaoCredito('aprovada'), { estagio: 'proposta_enviada' })
  assert.deepEqual(efeitoDaDecisaoCredito('negada'), { situacao: 'perdido' })
})

test('parcial não mexe em nada — a leitura é de quem está na mesa', () => {
  assert.equal(efeitoDaDecisaoCredito('parcial'), null)
})
