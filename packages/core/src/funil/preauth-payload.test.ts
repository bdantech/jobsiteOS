import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matrizDoSacado, normalizarPreAuthPayload } from './preauth-payload.ts'

const BASE = {
  id: 501,
  status: 'WAITING_CONTRACTED',
  origin: 'sienge',
  migrated: false,
  identification: 'PA-2026-501',
  createdAt: '2026-09-20T12:00:00Z',
  expiresAt: '2026-09-25T23:59:59Z',
  amount: '16500.00',
  invoiceNumber: '0084',
  dueDate: '2026-10-10',
  contractor: {
    name: 'SPE ILHAS VIRGENS',
    taxId: '11111111000272',
    headquartersTaxId: '11.111.111/0001-91',
  },
  contracted: { name: 'FOCUS COR', taxId: '22222222000122', registered: true },
  sienge: { billId: 4242, installmentId: 55, installmentNumber: 2, documentNumber: '0084' },
}

test('guarda as DUAS pontas do sacado: a SPE da operação e a matriz da relação', () => {
  const r = normalizarPreAuthPayload(BASE)
  assert.ok(r.ok)
  assert.equal(r.pre.sacado_cnpj, '11111111000272')
  assert.equal(r.pre.sacado_matriz_cnpj, '11111111000191')
})

test('sem headquartersTaxId, o próprio taxId É a matriz', () => {
  assert.deepEqual(matrizDoSacado({ taxId: '11111111000191' }), {
    sacado: '11111111000191',
    matriz: '11111111000191',
  })
})

test('fornecedor sem cadastro: nome nulo e a flag — é oportunidade de aquisição', () => {
  const r = normalizarPreAuthPayload({
    ...BASE,
    contracted: { name: null, taxId: '22222222000122', registered: false },
  })
  assert.ok(r.ok)
  assert.equal(r.pre.fornecedor_nome, null)
  assert.equal(r.pre.fornecedor_cadastrado, false)
})

test('o número normalizado usa a régua do 04e', () => {
  const r = normalizarPreAuthPayload(BASE)
  assert.ok(r.ok)
  assert.equal(r.pre.invoice_number, '0084')
  assert.equal(r.pre.numero_normalizado, '84')
})

test('valor ausente é DESCARTE COM MOTIVO, nunca zero', () => {
  const r = normalizarPreAuthPayload({ ...BASE, amount: null })
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.motivo, 'sem_valor')
})

test('a referência ao Sienge é guardada inteira — é a chave do casamento por id', () => {
  const r = normalizarPreAuthPayload(BASE)
  assert.ok(r.ok)
  assert.equal(r.pre.sienge_bill_id, 4242)
  assert.equal(r.pre.sienge_installment_id, 55)
  assert.equal(r.pre.sienge_installment_number, 2)
})
