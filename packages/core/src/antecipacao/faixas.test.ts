import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FiltroError, compileToSql } from '../mercado/filters.ts'
import {
  CATALOGO_FAIXAS,
  compileFaixaToPostgrest,
  compileFaixaToSql,
  descreverFaixa,
} from './faixas.ts'
import { calcularReceitaEsperada, calcularTipagem, renderizarTemplate, urgenciaDe } from './economia.ts'

/**
 * O engine das faixas é uma SEGUNDA instância do engine de filtros, sobre outro
 * catálogo. O que estes testes protegem é justamente o ISOLAMENTO entre os dois: um
 * catálogo compartilhado deixaria uma regra de faixa referenciar `capital_social` e
 * compilar para uma coluna que `notas_funil` não tem — erro que só aparece quando a
 * reclassificação noturna falha sobre 40 mil notas.
 */

test('toda variável do catálogo de faixas tem coluna ou derivação', () => {
  for (const v of CATALOGO_FAIXAS) {
    assert.ok(v.coluna || v.derivada, `"${v.id}" não tem coluna nem derivação — seria infiltrável`)
  }
})

test('o engine das faixas REJEITA variável do catálogo do Mercado', () => {
  // `capital_social` existe em mercado_explorador e não em notas_funil.
  assert.throws(
    () =>
      compileFaixaToSql({
        operador: 'e',
        condicoes: [{ variavel: 'capital_social', operador: 'maior_que', valor: 1 }],
      }),
    FiltroError,
  )
})

test('o engine do Mercado REJEITA variável do catálogo de faixas', () => {
  // O isolamento é nos dois sentidos: `dias_para_vencimento` não existe na view do
  // Explorador, e uma regra de camada não pode passar a referenciá-la por acidente.
  assert.throws(
    () =>
      compileToSql({
        operador: 'e',
        condicoes: [{ variavel: 'dias_para_vencimento', operador: 'maior_que', valor: 15 }],
      }),
    FiltroError,
  )
})

test('a regra seed da faixa alta compila com valores só em placeholders', () => {
  const { text, values } = compileFaixaToSql({
    operador: 'e',
    condicoes: [
      { variavel: 'fornecedor_cadastrado', operador: 'igual', valor: true },
      { variavel: 'sacado_credito_status', operador: 'igual', valor: 'APPROVED' },
      { variavel: 'sacado_limite_cobre_nota', operador: 'igual', valor: true },
      { variavel: 'dias_para_vencimento', operador: 'entre', valor: [15, 120] },
    ],
  })

  assert.equal(
    text,
    '(fornecedor_cadastrado = $1 and sacado_credito_status = $2 and ' +
      'sacado_limite_cobre_nota = $3 and dias_para_vencimento between $4 and $5)',
  )
  assert.deepEqual(values, [true, 'APPROVED', true, 15, 120])
  // Nenhum literal no texto: é a mesma garantia do engine do Mercado.
  assert.ok(!text.includes("'"))
})

test('a regra seed da faixa média usa "is distinct from" para não perder NULL', () => {
  // Um sacado sem análise de crédito TEM de casar "status diferente de APPROVED".
  const { text } = compileFaixaToSql({
    operador: 'e',
    condicoes: [{ variavel: 'sacado_credito_status', operador: 'diferente', valor: 'APPROVED' }],
  })
  assert.equal(text, '(sacado_credito_status is distinct from $1)')
})

test('compila para PostgREST com os valores citados', () => {
  const filtro = compileFaixaToPostgrest({
    operador: 'e',
    condicoes: [
      { variavel: 'estagio_funil', operador: 'igual', valor: 'a_prospectar' },
    ],
  })
  assert.equal(filtro, 'and(estagio_funil.eq."a_prospectar")')
})

test('rejeita valor fora das opções de um enum do catálogo de faixas', () => {
  assert.throws(
    () =>
      compileFaixaToSql({
        operador: 'e',
        condicoes: [{ variavel: 'tipo_nf', operador: 'igual', valor: 'NFCe' }],
      }),
    FiltroError,
  )
})

test('descreverFaixa usa os rótulos do catálogo de faixas', () => {
  const texto = descreverFaixa({
    operador: 'e',
    condicoes: [
      { variavel: 'sacado_limite_cobre_nota', operador: 'igual', valor: true },
      { variavel: 'dias_para_vencimento', operador: 'maior_ou_igual', valor: 15 },
    ],
  })
  assert.equal(
    texto,
    'Limite do sacado cobre a nota é igual a true E Dias para o vencimento é maior ou igual a 15',
  )
})

// ─── Economia ───────────────────────────────────────────────────────────────

test('receita esperada = valor × taxa × (dias ÷ 30)', () => {
  const r = calcularReceitaEsperada({ valor: 100_000, diasParaVencimento: 30, taxaMensal: 2 })
  assert.equal(r.receita, 2000)
  assert.equal(r.taxa, 2)
  assert.equal(r.taxa_padrao, false)
})

test('sem taxa do sacado, cai no padrão e sinaliza', () => {
  const r = calcularReceitaEsperada({
    valor: 100_000,
    diasParaVencimento: 60,
    taxaMensal: null,
    taxaPadrao: 1.5,
  })
  assert.equal(r.receita, 3000) // 100k × 1,5% × 2 meses
  assert.equal(r.taxa_padrao, true)
})

test('nota vencida gera receita ZERO, nunca negativa', () => {
  // Um número negativo subiria invertido na ordenação por receita esperada e
  // colocaria a pior nota no topo do Kanban.
  const r = calcularReceitaEsperada({ valor: 50_000, diasParaVencimento: -10, taxaMensal: 2 })
  assert.equal(r.receita, 0)
})

test('sem valor não há receita a estimar', () => {
  assert.equal(calcularReceitaEsperada({ valor: null, diasParaVencimento: 30 }).receita, null)
})

test('tipagem: não cadastrado é aquisição, independentemente do histórico', () => {
  assert.equal(calcularTipagem({ cadastrado: false, jaAntecipou: true }), 'aquisicao')
  assert.equal(calcularTipagem({ cadastrado: true, jaAntecipou: false }), 'ativacao')
  assert.equal(calcularTipagem({ cadastrado: true, jaAntecipou: true }), 'recorrencia')
})

test('urgência acompanha o mínimo operável', () => {
  assert.equal(urgenciaDe(-1, 7), 'vencida')
  assert.equal(urgenciaDe(3, 7), 'critica')
  assert.equal(urgenciaDe(15, 7), 'atencao')
  assert.equal(urgenciaDe(40, 7), 'confortavel')
  // Com um mínimo mais alto, 15 dias já é crítico.
  assert.equal(urgenciaDe(15, 20), 'critica')
})

test('template: chave desconhecida fica visível em vez de sumir', () => {
  // Sumir em silêncio esconderia o erro de digitação de quem escreveu o template —
  // e a Outbox existe justamente para que ele seja visto antes de ligar os canais.
  const texto = renderizarTemplate('Olá {fornecedor_nome}, {qtd_notas} notas. {inexistente}', {
    fornecedor_nome: 'ACME',
    qtd_notas: '3',
  })
  assert.equal(texto, 'Olá ACME, 3 notas. {inexistente}')
})
