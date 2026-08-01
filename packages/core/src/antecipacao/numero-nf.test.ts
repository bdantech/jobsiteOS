import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizarNumeroNf } from './numero-nf.ts'

/**
 * O que este teste protege não é o formato: é a assimetria entre zeros à
 * esquerda (que saem) e zeros à direita (que ficam). Perder essa distinção marca
 * a nota errada como convertida, em silêncio, e o funil passa a mentir.
 */

test('zeros à esquerda saem — é a mesma nota escrita por dois sistemas', () => {
  assert.equal(normalizarNumeroNf('0084'), '84')
  assert.equal(normalizarNumeroNf('000000084'), '84')
  assert.equal(normalizarNumeroNf('84'), '84')
})

test('zeros à direita NUNCA saem — 84 e 840 são notas diferentes', () => {
  assert.equal(normalizarNumeroNf('840'), '840')
  assert.equal(normalizarNumeroNf('88210'), '88210')
  assert.notEqual(normalizarNumeroNf('84'), normalizarNumeroNf('840'))
})

test('série como sufixo separado sai do núcleo', () => {
  assert.equal(normalizarNumeroNf('8821/1'), '8821')
  assert.equal(normalizarNumeroNf('8821-001'), '8821')
  assert.equal(normalizarNumeroNf('8821 / 1'), '8821')
  assert.equal(normalizarNumeroNf('8821 S1'), '8821')
  assert.equal(normalizarNumeroNf('8821 S. 1'), '8821')
  assert.equal(normalizarNumeroNf('8821 SERIE 1'), '8821')
  assert.equal(normalizarNumeroNf('8821 SÉRIE 1'), '8821')
})

test('série de até 3 dígitos, e não mais — 2024-1234 é número, não série', () => {
  assert.equal(normalizarNumeroNf('8821-999'), '8821')
  // Quatro dígitos depois do traço não são série de NFe. Cortar aqui produziria
  // `2024`, que casa com uma nota que existe e não é esta.
  assert.equal(normalizarNumeroNf('2024-1234'), '20241234')
})

test('separadores e prefixos de prosa somem', () => {
  assert.equal(normalizarNumeroNf('1.234'), '1234')
  assert.equal(normalizarNumeroNf('NF 8821'), '8821')
  assert.equal(normalizarNumeroNf('  8821  '), '8821')
  assert.equal(normalizarNumeroNf('NF-e 8821'), '8821')
})

test('a remoção de série vem ANTES da de separadores', () => {
  // Invertida a ordem, `8821 S1` viraria `88211`: um número que não existe e que
  // pode existir em outra nota do mesmo par.
  assert.equal(normalizarNumeroNf('8821 S1'), '8821')
})

test('sem dígito nenhum é null, não string vazia', () => {
  assert.equal(normalizarNumeroNf(''), null)
  assert.equal(normalizarNumeroNf('   '), null)
  assert.equal(normalizarNumeroNf('SEM NUMERO'), null)
  assert.equal(normalizarNumeroNf('000'), null)
  assert.equal(normalizarNumeroNf(null), null)
  assert.equal(normalizarNumeroNf(undefined), null)
})

test('aceita número, não só texto — o payload manda os dois', () => {
  assert.equal(normalizarNumeroNf(84), '84')
  assert.equal(normalizarNumeroNf(840), '840')
})
