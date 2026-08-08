import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CAMPOS_IMPORTACAO, anoDoCabecalho, ehCampoMetrica } from './schemas.ts'
import { ORIGENS_METRICA, origemVence } from '../radar/faturamento.ts'

/**
 * O que se testa aqui é o que decide para onde um número da planilha vai parar:
 * o ano que ele carrega e se ele pode ou não sobrescrever o que já está no cache.
 */

test('anoDoCabecalho: lê o ano escrito na coluna', () => {
  assert.equal(anoDoCabecalho('Receita Bruta 2023 (R$)'), 2023)
  assert.equal(anoDoCabecalho('Patrimônio Líquido 2024 (R$)'), 2024)
  assert.equal(anoDoCabecalho('2024'), 2024)
  // A primeira ocorrência: é o ano que dá título à coluna.
  assert.equal(anoDoCabecalho('PL 2024 (base 2023)'), 2024)
})

test('anoDoCabecalho: null quando não há ano — e a tela pede', () => {
  assert.equal(anoDoCabecalho('Funcionários'), null)
  assert.equal(anoDoCabecalho('Pessoal Graduado'), null)
  // "Variação 23/24" não tem ano de quatro dígitos: dois dígitos seriam adivinhação.
  assert.equal(anoDoCabecalho('Variação 23/24'), null)
  // Não confundir com outros números grandes de quatro dígitos.
  assert.equal(anoDoCabecalho('Faturamento em 1000 R$'), null)
  assert.equal(anoDoCabecalho('Contratos 1998'), null)
})

test('ehCampoMetrica separa série de coluna', () => {
  assert.equal(ehCampoMetrica('faturamento_anual'), true)
  assert.equal(ehCampoMetrica('funcionarios'), true)
  assert.equal(ehCampoMetrica('patrimonio_liquido'), true)
  assert.equal(ehCampoMetrica('erp_mrr'), false)
  assert.equal(ehCampoMetrica('razao_social'), false)
  assert.equal(ehCampoMetrica(null), false)
})

test('os três campos de métrica estão no catálogo de importação', () => {
  for (const campo of ['faturamento_anual', 'funcionarios', 'patrimonio_liquido'] as const) {
    assert.ok(CAMPOS_IMPORTACAO.includes(campo), `${campo} fora de CAMPOS_IMPORTACAO`)
  }
})

test('hierarquia: publicacao ganha do Apollo e perde do cliente', () => {
  // O ponto todo da origem nova: um ranking publica o número que a empresa
  // informou; o Apollo conta perfis de LinkedIn e subconta canteiro.
  assert.equal(origemVence('publicacao', 'apollo'), true)
  assert.equal(origemVence('publicacao', 'apollo_search'), true)
  assert.equal(origemVence('publicacao', 'modelo'), true)
  assert.equal(origemVence('publicacao', 'bracket_simples'), true)
  assert.equal(origemVence('publicacao', 'lista'), true)

  assert.equal(origemVence('publicacao', 'declarado_cliente'), false)
  assert.equal(origemVence('apollo', 'publicacao'), false)
  assert.equal(origemVence('modelo', 'publicacao'), false)

  // A mesma fonte falando de novo é leitura mais recente, não leitura pior.
  assert.equal(origemVence('publicacao', 'publicacao'), true)
  // Campo vazio aceita qualquer coisa.
  assert.equal(origemVence('publicacao', null), true)
})

test('a ordem antiga continua valendo entre as origens que já existiam', () => {
  assert.equal(origemVence('declarado_cliente', 'apollo'), true)
  assert.equal(origemVence('apollo', 'lista'), true)
  assert.equal(origemVence('lista', 'modelo'), true)
  assert.equal(origemVence('modelo', 'bracket_simples'), true)
  assert.equal(origemVence('bracket_simples', 'modelo'), false)
})

test('ORIGENS_METRICA cobre o que o CHECK do banco aceita (0081)', () => {
  assert.deepEqual(
    [...ORIGENS_METRICA].sort(),
    [
      'apollo',
      'apollo_search',
      'bracket_simples',
      'declarado_cliente',
      'lista',
      'modelo',
      'publicacao',
    ],
  )
})
