import assert from 'node:assert/strict'
import { test } from 'node:test'
import { speDoSacado } from './sacado.ts'

const RIBEIRO = { nome: 'RIBEIRO CARAM', cnpj: '01869256000100' }

test('mesmo CNPJ: a segunda linha some, por pior que o XML escreva o nome', () => {
  // Os quatro jeitos que a Ribeiro Caram aparece hoje no XML dos fornecedores.
  for (const doXml of [
    'CONSTRUTORA RIBEIRO CARAM LTDA.',
    'CONSTRUTORA RIBEIRO CARAM',
    'CONSTRUTURA RIBERIO CARAM LTDA',
    'CONSTRUTORA RIBEIRO CARAM LTDA -',
  ]) {
    assert.equal(speDoSacado(RIBEIRO, '01869256000100', doXml), null, doXml)
  }
})

test('CNPJ diferente: é SPE, e o nome do XML é o que identifica a obra', () => {
  assert.equal(
    speDoSacado(RIBEIRO, '11222333000181', 'SPE ILHAS VIRGENS EMPREENDIMENTOS LTDA'),
    'SPE ILHAS VIRGENS EMPREENDIMENTOS LTDA',
  )
})

test('filial (mesma raiz, CNPJ diferente) continua mostrando as duas', () => {
  /*
   * Decisão consciente: a filial é a mesma pessoa jurídica, mas é OUTRO
   * estabelecimento, e o nome do XML costuma dizer qual ("— SEDE", "— FILIAL SP").
   * Esconder isso apagaria a única pista de onde a nota foi faturada.
   */
  assert.equal(
    speDoSacado(RIBEIRO, '01869256000291', 'CONSTRUTORA RIBEIRO CARAM — FILIAL SP'),
    'CONSTRUTORA RIBEIRO CARAM — FILIAL SP',
  )
})

test('nome idêntico some mesmo sem CNPJ dos dois lados', () => {
  assert.equal(speDoSacado({ nome: 'ACME LTDA', cnpj: null }, null, 'ACME LTDA'), null)
})

test('na dúvida, MOSTRA: CNPJ faltando de um lado não esconde uma SPE', () => {
  assert.equal(
    speDoSacado({ nome: 'ACME LTDA', cnpj: null }, '11222333000181', 'SPE OBRA 4'),
    'SPE OBRA 4',
  )
  assert.equal(speDoSacado(RIBEIRO, null, 'SPE OBRA 4'), 'SPE OBRA 4')
})

test('sem conta resolvida não há segunda linha — o card já mostra o sacado em cima', () => {
  assert.equal(speDoSacado(null, '11222333000181', 'SPE OBRA 4'), null)
  assert.equal(speDoSacado(undefined, '11222333000181', 'SPE OBRA 4'), null)
})
