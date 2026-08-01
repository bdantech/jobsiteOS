import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  categoriaNaturezaJuridica,
  codigoNaturezaJuridica,
} from './natureza-juridica.ts'

/**
 * Os valores aqui são os que EXISTEM na base — saíram de
 * `select natureza_juridica, count(*) from mercado_universo`. O formato com
 * descrição colada ("2062 - Sociedade Empresária Limitada") é o único que a
 * Receita entrega, e um parser que só aceitasse o código puro devolveria `null`
 * para 100% da base sem que nada quebrasse.
 */

test('o formato real da Receita é aceito', () => {
  assert.equal(categoriaNaturezaJuridica('2062 - Sociedade Empresária Limitada'), 'ltda')
  assert.equal(categoriaNaturezaJuridica('2054 - Sociedade Anônima Fechada'), 'sa')
  assert.equal(categoriaNaturezaJuridica('2046 - Sociedade Anônima Aberta'), 'sa')
  assert.equal(categoriaNaturezaJuridica('2240 - Sociedade Simples Limitada'), 'ltda')
  assert.equal(categoriaNaturezaJuridica('2135 - Empresário (Individual)'), 'outras')
  assert.equal(categoriaNaturezaJuridica('2127 - Sociedade em Conta de Participação'), 'outras')
})

test('código puro e com hífen dão o mesmo resultado', () => {
  assert.equal(categoriaNaturezaJuridica('2062'), 'ltda')
  assert.equal(categoriaNaturezaJuridica('206-2'), 'ltda')
  assert.equal(codigoNaturezaJuridica('206-2'), '2062')
  assert.equal(codigoNaturezaJuridica('2062 - Sociedade Empresária Limitada'), '2062')
})

test('EIRELI existe no mapa, mas é residual por lei — não por descuido', () => {
  // Extinta em 2021 e convertida em SLU, que a Receita registra como 2062. Um
  // achado vazio nesta categoria não diz nada sobre unipessoais: elas estão em
  // `ltda`, indistinguíveis.
  assert.equal(categoriaNaturezaJuridica('2305 - Empresa Individual de Resp. Limitada'), 'eireli_slu')
  assert.equal(categoriaNaturezaJuridica('2321 - Sociedade Unipessoal de Advocacia'), 'eireli_slu')
})

test('sem dado é null, e null NÃO é "outras"', () => {
  // A diferença sustenta a cobertura: "é de outro tipo" entra na distribuição,
  // "não sabemos" sai dela.
  assert.equal(categoriaNaturezaJuridica(null), null)
  assert.equal(categoriaNaturezaJuridica(undefined), null)
  assert.equal(categoriaNaturezaJuridica(''), null)
  assert.equal(categoriaNaturezaJuridica('   '), null)
  assert.equal(categoriaNaturezaJuridica('Sociedade Limitada'), null)
  assert.equal(categoriaNaturezaJuridica('20'), null)
})
