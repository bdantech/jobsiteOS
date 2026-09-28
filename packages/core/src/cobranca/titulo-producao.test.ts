import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extrairTitulosProducao, normalizarTituloProducao, type TituloProducaoPayload } from './titulo-producao.ts'

/** O formato documentado pela produção em 28/09/2026 (jobsiteos-resposta-titulos.md). */
const base: TituloProducaoPayload = {
  id: 'tit_54479',
  anticipationId: 54479,
  migrated: true,
  documentNumber: '5303',
  contractor: {
    name: 'MORROVERDE EMPREENDIMENTOS LTDA',
    taxId: '39.908.516/0001-74',
    headquartersTaxId: '39908516000174',
    thirdParty: false,
  },
  contracted: { name: 'QG MATERIAIS DE CONSTRUCAO LTDA', taxId: '04927046000101', headquartersTaxId: '04927046000101' },
  grossValue: 9030,
  invoiceAmount: 9030,
  withheldTaxAmount: 0,
  netValue: 8481.89,
  disbursedAt: '2026-08-11T10:00:00-03:00',
  originalDueDate: '2026-09-30',
  currentDueDate: '2026-09-30',
  overdue: false,
  settlement: { status: 'OPEN', paidAt: null, source: null, paidAmount: null, payments: [] },
  drawee: { taxId: '39908516000174', creditLimit: 500000, creditLimitUpdatedAt: null, creditLimitExpiresAt: '2027-03-01' },
  updatedAt: '2026-09-28T09:12:00-03:00',
}

test('título em aberto: matriz da produção, valor do boleto, limite e o elo com a antecipação', () => {
  const r = normalizarTituloProducao(base)
  assert.ok(r.ok)
  const t = r.titulo
  assert.equal(t.externo_id, 'tit_54479')
  assert.equal(t.antecipacao_id_externo, 54479)
  assert.equal(t.migrado, true)
  assert.equal(t.sacado_cnpj, '39908516000174')
  assert.equal(t.sacado_matriz_cnpj, '39908516000174')
  assert.equal(t.status, 'aberto')
  assert.equal(t.valor_face, 9030)
  assert.equal(t.valor_cedido, 8481.89)
  assert.equal(t.vencimento, '2026-09-30')
  assert.equal(t.vencimento_prorrogado, null)
  assert.equal(t.pago_em, null)
  assert.equal(t.limite_credito_vigente, 500000)
})

test('grossValue aqui é o boleto (nota − retenção); a nota e a retenção vão separadas', () => {
  const r = normalizarTituloProducao({ ...base, grossValue: 9000, invoiceAmount: 10000, withheldTaxAmount: 1000 })
  assert.ok(r.ok)
  assert.equal(r.titulo.valor_face, 9000)
  assert.equal(r.titulo.valor_nota, 10000)
  assert.equal(r.titulo.retencao, 1000)
})

test('pago: paidAt vira pago_em (data do pagamento, não do registro) com a fonte', () => {
  const r = normalizarTituloProducao({
    ...base,
    settlement: { status: 'PAID', paidAt: '2026-10-01T00:00:00-03:00', source: 'CNAB_RETURN', paidAmount: 9030, payments: [{ amount: 9030 }] },
  })
  assert.ok(r.ok)
  assert.equal(r.titulo.status, 'pago')
  assert.equal(r.titulo.pago_em, '2026-10-01')
  assert.equal(r.titulo.liquidacao_fonte, 'CNAB_RETURN')
  assert.equal(r.titulo.valor_pago, 9030)
  assert.equal(r.titulo.liquidacao_pagamentos.length, 1)
})

test('parcial não regulariza: pago_em fica nulo mesmo com valor recebido', () => {
  const r = normalizarTituloProducao({
    ...base,
    settlement: { status: 'PARTIALLY_PAID', paidAt: '2026-10-01', paidAmount: 4000 },
  })
  assert.ok(r.ok)
  assert.equal(r.titulo.status, 'parcial')
  assert.equal(r.titulo.pago_em, null)
  assert.equal(r.titulo.valor_pago, 4000)
})

test('vencimento vigente diferente do original vai para vencimento_prorrogado; o original fica', () => {
  const r = normalizarTituloProducao({ ...base, currentDueDate: '2026-10-15' })
  assert.ok(r.ok)
  assert.equal(r.titulo.vencimento, '2026-09-30')
  assert.equal(r.titulo.vencimento_prorrogado, '2026-10-15')
})

test('limite nulo continua nulo (sem análise aprovada), nunca zero', () => {
  const r = normalizarTituloProducao({ ...base, drawee: { taxId: '39908516000174', creditLimit: null } })
  assert.ok(r.ok)
  assert.equal(r.titulo.limite_credito_vigente, null)
})

test('descarta com motivo, sem inventar', () => {
  const casos: [TituloProducaoPayload, string][] = [
    [{ ...base, id: null }, 'sem_id'],
    [{ ...base, contractor: { taxId: '123' } }, 'sem_devedor'],
    [{ ...base, contracted: null }, 'sem_cedente'],
    [{ ...base, grossValue: null }, 'sem_valor'],
    [{ ...base, originalDueDate: null }, 'sem_vencimento'],
    [{ ...base, settlement: { status: 'BOUGHT_BACK' } }, 'status_desconhecido'],
  ]
  for (const [p, motivo] of casos) {
    const r = normalizarTituloProducao(p)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.motivo, motivo)
  }
})

test('envelope: data ou items', () => {
  assert.equal(extrairTitulosProducao({ data: [base] }).length, 1)
  assert.equal(extrairTitulosProducao({ items: [base, base] }).length, 2)
  assert.equal(extrairTitulosProducao({}).length, 0)
})
