import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cnpjMatrizDe, isValidCnpj } from '../schemas/cnpj.ts'
import { sacadoEmCobranca } from './bloqueio.ts'

// 11.222.333/0001-81 é a matriz; 11.222.333/0002-62 uma filial da mesma raiz.
const MATRIZ = '11222333000181'
const FILIAL = '11222333000262'
const SPE = '47383971000121'

test('a matriz da mesma raiz sai com os dígitos verificadores certos', () => {
  assert.equal(cnpjMatrizDe(FILIAL), MATRIZ)
  assert.equal(cnpjMatrizDe('11.222.333/0002-62'), MATRIZ)
  assert.equal(cnpjMatrizDe(MATRIZ), MATRIZ)
  assert.ok(isValidCnpj(cnpjMatrizDe(FILIAL) as string))
  assert.equal(cnpjMatrizDe('123'), null)
})

test('casa pelo próprio CNPJ, pela matriz informada e pela matriz da raiz', () => {
  const bloqueados = new Set([MATRIZ])
  assert.equal(sacadoEmCobranca(bloqueados, MATRIZ), true)
  // filial que a cobrança não conhecia: mesma raiz, mesma matriz
  assert.equal(sacadoEmCobranca(bloqueados, FILIAL), true)
  // SPE de outra raiz, mas a tela sabe que a holding é a matriz bloqueada
  assert.equal(sacadoEmCobranca(bloqueados, SPE, MATRIZ), true)
})

test('SPE de outra raiz sem matriz informada só casa se estiver na lista', () => {
  assert.equal(sacadoEmCobranca(new Set([MATRIZ]), SPE), false)
  assert.equal(sacadoEmCobranca(new Set([MATRIZ, SPE]), SPE), true)
})

test('lista vazia e sacado ausente nunca bloqueiam', () => {
  assert.equal(sacadoEmCobranca(new Set(), MATRIZ), false)
  assert.equal(sacadoEmCobranca(new Set([MATRIZ]), null, undefined), false)
})
