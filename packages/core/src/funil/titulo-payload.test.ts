import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizarTituloPayload, retencaoTriEstado } from './titulo-payload.ts'

const BASE = {
  id: 77_001,
  situation: 'ready_to_create',
  firstSeenAt: '2026-09-18T03:12:00Z',
  hydratedAt: '2026-09-22T05:31:00Z',
  installmentId: 55,
  installmentNumber: 2,
  amount: 17_348.71,
  dueDate: '2026-11-04',
  bill: { billId: 4242, documentNumber: '0084/1', accessKey: '3'.repeat(44), totalAmount: 52_046.13 },
  connection: { id: 7, subdomain: 'engefy' },
  contractor: { name: 'ENGEFY', taxId: '11.111.111/0001-91' },
  creditor: { name: 'NG CONSTRUÇÃO', taxId: '22222222000122', erpId: 9 },
}

test('a retenção é TRI-ESTADO: 0, valor e null são três coisas', () => {
  assert.equal(retencaoTriEstado(0), 0)
  assert.equal(retencaoTriEstado('1234.50'), 1234.5)
  assert.equal(retencaoTriEstado(null), null)
  assert.equal(retencaoTriEstado(undefined), null)
  // O caso que o bug clássico produz: string vazia virando zero.
  assert.equal(retencaoTriEstado(''), null)
})

test('withheldTax ausente NÃO vira zero na linha gravada', () => {
  const r = normalizarTituloPayload(BASE)
  assert.ok(r.ok)
  assert.equal(r.titulo.retencao, null)
  assert.equal(r.titulo.bill_retencao_total, null)

  const comZero = normalizarTituloPayload({ ...BASE, withheldTax: 0 })
  assert.ok(comZero.ok)
  assert.equal(comZero.titulo.retencao, 0)
})

test('firstSeenAt e hydratedAt são campos DIFERENTES e não se confundem', () => {
  const r = normalizarTituloPayload(BASE)
  assert.ok(r.ok)
  assert.equal(r.titulo.primeira_vez_visto, '2026-09-18T03:12:00Z')
  assert.equal(r.titulo.hidratado_em, '2026-09-22T05:31:00Z')
})

test('credor pessoa física: taxId nulo vira a flag, não um CNPJ inventado', () => {
  const r = normalizarTituloPayload({
    ...BASE,
    creditor: { name: 'JOÃO DA SILVA', taxId: null, erpId: 12 },
  })
  assert.ok(r.ok)
  assert.equal(r.titulo.credor_cnpj, null)
  assert.equal(r.titulo.credor_pessoa_fisica, true)
  assert.equal(r.titulo.credor_nome, 'JOÃO DA SILVA')
})

test('o sacado do título é a MATRIZ: não há SPE nesta fonte', () => {
  const r = normalizarTituloPayload(BASE)
  assert.ok(r.ok)
  assert.equal(r.titulo.sacado_cnpj, '11111111000191')
  assert.equal(r.titulo.sacado_matriz_cnpj, '11111111000191')
})

test('o número do documento passa pelo MESMO normalizador do 04e', () => {
  const r = normalizarTituloPayload(BASE)
  assert.ok(r.ok)
  // `0084/1` → zeros à esquerda saem, a série sai. `84`.
  assert.equal(r.titulo.numero_normalizado, '84')
})

test('chave de acesso torta é descartada em vez de poluir o índice', () => {
  const r = normalizarTituloPayload({ ...BASE, bill: { ...BASE.bill, accessKey: '123' } })
  assert.ok(r.ok)
  assert.equal(r.titulo.bill_access_key, null)
})

test('sem id, sem situação, sem valor ou sem bill: descarte com MOTIVO', () => {
  assert.deepEqual(normalizarTituloPayload({ ...BASE, id: null }), {
    ok: false,
    motivo: 'sem_id',
    id: null,
  })
  const semValor = normalizarTituloPayload({ ...BASE, amount: null })
  assert.equal(semValor.ok === false && semValor.motivo, 'sem_valor')

  const semBill = normalizarTituloPayload({ ...BASE, bill: { documentNumber: 'x' } })
  assert.equal(semBill.ok === false && semBill.motivo, 'sem_bill')
})
