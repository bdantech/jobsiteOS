import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DDDS_VALIDOS, ehWhatsappProvavel, normalizarTelefoneBr } from './telefone.ts'

test('as seis formas em que as fontes escrevem o mesmo celular viram um valor só', () => {
  const formas = [
    '(11) 98765-4321',
    '11987654321',
    '+55 11 98765-4321',
    '5511987654321',
    '011 98765 4321',
    ' 11 9 8765 4321 ',
  ]
  for (const f of formas) {
    assert.equal(normalizarTelefoneBr(f).e164, '+5511987654321', f)
  }
})

test('fixo de 8 dígitos não ganha nono dígito', () => {
  const r = normalizarTelefoneBr('(11) 3333-4444')
  assert.equal(r.e164, '+551133334444')
  assert.equal(r.tipo, 'fixo')
  assert.equal(r.nono_digito_inferido, false)
})

test('celular do cadastro antigo ganha o 9 e diz que foi inferido', () => {
  const r = normalizarTelefoneBr('(11) 8765-4321')
  assert.equal(r.e164, '+5511987654321')
  assert.equal(r.tipo, 'movel')
  assert.equal(r.nono_digito_inferido, true)
  // É o que faz `1187654321` e `11987654321` deduplicarem para a mesma linha.
  assert.equal(normalizarTelefoneBr('11987654321').e164, r.e164)
})

test('DDD 55 não é o código do país: 5533221100 tem dez dígitos e é de Santa Maria', () => {
  const r = normalizarTelefoneBr('5533221100')
  assert.equal(r.ddd, '55')
  assert.equal(r.e164, '+555533221100')
})

test('CEP e inscrição estadual não viram telefone', () => {
  // 01310-100 (Av. Paulista) → DDD 01 não existe.
  assert.equal(normalizarTelefoneBr('01310100').valido, false)
  assert.equal(normalizarTelefoneBr('01310100', { dddPadrao: null }).motivo, 'sem_ddd')
  assert.equal(normalizarTelefoneBr('2010101010').motivo, 'ddd_inexistente')
})

test('número repetido é campo obrigatório preenchido de qualquer jeito', () => {
  assert.equal(normalizarTelefoneBr('11111111111').motivo, 'repetido')
  assert.equal(normalizarTelefoneBr('(99) 99999-9999').motivo, 'repetido')
})

test('sem DDD só resolve com o cadastral, e nunca chuta', () => {
  assert.equal(normalizarTelefoneBr('98765-4321').motivo, 'sem_ddd')
  assert.equal(normalizarTelefoneBr('98765-4321', { dddPadrao: '31' }).e164, '+5531987654321')
})

test('0800 é contato de verdade e não morre no filtro de DDD', () => {
  const r = normalizarTelefoneBr('0800 123 4567')
  assert.equal(r.valido, true)
  assert.equal(r.tipo, 'especial')
  assert.equal(r.ddd, null)
})

test('nove dígitos que não começam com 9 são número truncado', () => {
  assert.equal(normalizarTelefoneBr('11833334444').motivo, 'prefixo_impossivel')
})

test('WhatsApp é palpite e só para celular', () => {
  assert.equal(ehWhatsappProvavel(normalizarTelefoneBr('11987654321')), true)
  assert.equal(ehWhatsappProvavel(normalizarTelefoneBr('1133334444')), false)
  assert.equal(ehWhatsappProvavel(normalizarTelefoneBr('0800 123 4567')), false)
})

test('a lista de DDDs é a da Anatel, não uma faixa', () => {
  assert.equal(DDDS_VALIDOS.has('11'), true)
  assert.equal(DDDS_VALIDOS.has('36'), false) // não existe
  assert.equal(DDDS_VALIDOS.has('23'), false)
  assert.equal(DDDS_VALIDOS.size, 67)
})
