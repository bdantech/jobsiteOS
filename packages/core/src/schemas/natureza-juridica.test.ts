import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  NATUREZAS_JURIDICAS,
  NATUREZA_JURIDICA_CODIGOS,
  NATUREZA_JURIDICA_LABELS,
  rotuloNaturezaJuridica,
} from './natureza-juridica.ts'
import { codigoNaturezaJuridica } from '../perfil/natureza-juridica.ts'
import { variavelFaixa } from '../antecipacao/faixas.ts'

/**
 * A tabela é dado transcrito de uma fonte externa (CONCLA/IBGE 2021), e dado
 * transcrito à mão erra. Estes testes cobrem as três formas de errar que fariam a
 * regra de faixa mentir em silêncio: código duplicado (o último venceria no mapa de
 * rótulos), código fora do formato de 4 dígitos (nunca casaria com a coluna
 * normalizada da view) e um código que a nossa própria base tem e a tabela não
 * oferece (a natureza existiria nas notas e não no dropdown).
 */

test('todo código tem 4 dígitos e aparece uma vez só', () => {
  const vistos = new Set<string>()
  for (const n of NATUREZAS_JURIDICAS) {
    assert.match(n.codigo, /^[0-9]{4}$/, `código fora do formato: ${n.codigo}`)
    assert.equal(vistos.has(n.codigo), false, `código duplicado: ${n.codigo}`)
    assert.notEqual(n.label.trim(), '', `código sem rótulo: ${n.codigo}`)
    vistos.add(n.codigo)
  }
  assert.equal(NATUREZA_JURIDICA_CODIGOS.length, NATUREZAS_JURIDICAS.length)
})

/**
 * Os 51 códigos que `select distinct natureza_juridica from mercado_universo`
 * devolve hoje, normalizados. Se a tabela não cobrir um deles, existe fornecedor na
 * base com uma natureza que o operador não consegue selecionar.
 */
const NA_BASE = [
  '1015', '1023', '1031', '1058', '1066', '1104', '1112', '1120', '1147', '1155',
  '1171', '1180', '1210', '1244', '1317', '1325', '1333', '2011', '2038', '2046',
  '2054', '2062', '2070', '2089', '2097', '2127', '2135', '2143', '2151', '2160',
  '2178', '2216', '2224', '2232', '2240', '2267', '2283', '2305', '2321', '2348',
  '3034', '3069', '3077', '3085', '3131', '3212', '3220', '3263', '3999', '4014',
  '4120',
]

test('a tabela cobre toda natureza que existe na base', () => {
  const ausentes = NA_BASE.filter((c) => !NATUREZA_JURIDICA_LABELS[c])
  assert.deepEqual(ausentes, [])
})

/**
 * O contrato que liga as duas pontas: o que o parser extrai do texto da Receita tem
 * de ser uma chave da tabela. É o que garante que a coluna `fornecedor_natureza_juridica`
 * (normalizada pelo SQL equivalente, na 0105) case com uma opção do dropdown.
 */
test('o código extraído do texto da Receita é uma opção do dropdown', () => {
  for (const bruto of [
    '2062 - Sociedade Empresária Limitada',
    '2062',
    '206-2',
    '2054 - Sociedade Anônima Fechada',
    '4120',
  ]) {
    const codigo = codigoNaturezaJuridica(bruto)
    assert.ok(codigo, `não extraiu código de "${bruto}"`)
    assert.ok(NATUREZA_JURIDICA_LABELS[codigo], `"${codigo}" não está na tabela`)
  }
})

test('o rótulo mostra o código junto — é ele que fica gravado na regra', () => {
  assert.equal(rotuloNaturezaJuridica('2062'), '2062 — Sociedade Empresária Limitada')
  // Código fora da tabela não vira string vazia: some do dropdown, mas se aparecer
  // numa regra antiga tem de continuar legível.
  assert.equal(rotuloNaturezaJuridica('9999'), '9999')
})

test('a variável de faixa oferece a tabela inteira, com rótulos', () => {
  const v = variavelFaixa('fornecedor_natureza_juridica')
  assert.ok(v, 'variável ausente do catálogo de faixas')
  assert.equal(v.tipo, 'enum')
  assert.equal(v.coluna, 'fornecedor_natureza_juridica')
  assert.equal(v.opcoes?.length, NATUREZAS_JURIDICAS.length)
  assert.equal(v.rotulos?.['2062'], 'Sociedade Empresária Limitada')
})
