import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FiltroError, compileToSql } from '../mercado/filters.ts'
import {
  CATALOGO_FAIXAS,
  compileFaixaToPostgrest,
  compileFaixaToSql,
  descreverFaixa,
} from './faixas.ts'
import {
  abaixoDoMinimoOperavel,
  calcularReceitaEsperada,
  calcularTipagem,
  motivoValorAbaixoDoMinimo,
  renderizarTemplate,
  urgenciaDe,
  custosDaAntecipacao,
  valorLiquidoEstimado,
} from './economia.ts'

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

test('as variáveis cadastrais do fornecedor são PREFIXADAS, não homônimas', () => {
  // `fornecedor_capital_social` e `capital_social` apontam para a MESMA coluna de
  // origem (mercado_universo.capital_social) em views diferentes. Se a variável
  // das faixas se chamasse `capital_social`, o teste de isolamento acima passaria
  // a compilar em vez de lançar, e o guarda-corpo entre os dois catálogos sumiria
  // sem que nada quebrasse — o pior tipo de regressão.
  const ids = CATALOGO_FAIXAS.map((v) => v.id)
  assert.ok(ids.includes('fornecedor_capital_social'))
  assert.ok(!ids.includes('capital_social'))

  const sql = compileFaixaToSql({
    operador: 'e',
    condicoes: [{ variavel: 'fornecedor_capital_social', operador: 'maior_que', valor: 100_000 }],
  })
  assert.match(sql.text, /fornecedor_capital_social/)
  assert.deepEqual(sql.values, [100_000])
})

test('o proxy de porte compila como número e aceita corte por faixa', () => {
  // O uso real: "tire do funil quem já passou da nota 500 mil" — fornecedor
  // grande demais para precisar antecipar.
  const sql = compileFaixaToSql({
    operador: 'e',
    condicoes: [
      { variavel: 'fornecedor_ultimo_numero_nf', operador: 'menor_que', valor: 500_000 },
      { variavel: 'fornecedor_situacao_cadastral', operador: 'igual', valor: 'ativa' },
    ],
  })
  assert.match(sql.text, /fornecedor_ultimo_numero_nf/)
  assert.match(sql.text, /fornecedor_situacao_cadastral/)
  assert.deepEqual(sql.values, [500_000, 'ativa'])
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

test('o líquido desconta juros, TAC e seguro — e as quatro parcelas fecham o valor', () => {
  assert.equal(valorLiquidoEstimado({ valor: 100_000, receitaEsperada: 1_990, tac: 300, seguro: 125 }), 97_585)

  // A invariante nova: valor = juros + tac + seguro + líquido.
  const valor = 43_210.55
  const receita = calcularReceitaEsperada({ valor, diasParaVencimento: 47, taxaMensal: 2.3 }).receita!
  const c = custosDaAntecipacao({ receitaEsperada: receita, tac: 226.2, seguro: 125 })!
  const liquido = valorLiquidoEstimado({ valor, receitaEsperada: receita, tac: 226.2, seguro: 125 })!
  assert.equal(Math.round((c.juros + c.tac + c.seguro + liquido) * 100) / 100, valor)
})

test('o caso real da plataforma: net = bruto − spread − 125', () => {
  // Documento 759, 31 dias, 3,0% a.m. O spread da plataforma embute juros E TAC,
  // então aqui ele entra inteiro como `receitaEsperada` e a TAC vai a zero.
  const liquido = valorLiquidoEstimado({
    valor: 83_495.89,
    receitaEsperada: 2_824.52,
    tac: 0,
    seguro: 125,
  })
  assert.equal(liquido, 80_546.37)
})

test('nota vencida não tem deságio, mas AINDA tem tarifa', () => {
  const { receita } = calcularReceitaEsperada({ valor: 5_000, diasParaVencimento: -3 })
  assert.equal(receita, 0)
  // O deságio zera com o prazo; a TAC e o seguro não são tempo, são preço.
  assert.equal(valorLiquidoEstimado({ valor: 5_000, receitaEsperada: receita, tac: 225, seguro: 125 }), 4_650)
})

test('tarifa maior que a nota não devolve negativo — devolve zero', () => {
  // Nota de R$ 200 com R$ 275 de tarifa. Um negativo na tela seria lido como bug;
  // o zero é a verdade: não sobra nada, e essa nota não se antecipa.
  assert.equal(valorLiquidoEstimado({ valor: 200, receitaEsperada: 5, tac: 150, seguro: 125 }), 0)
})

test('as parcelas ausentes valem zero, mas o juros ausente ainda anula a conta', () => {
  // TAC desconhecida é 0 — é o pior caso para NÓS (líquido maior), e some quando
  // o sync grava a estimativa. Juros desconhecido é `null`: sem ele não há conta.
  assert.equal(valorLiquidoEstimado({ valor: 1_000, receitaEsperada: 10 }), 990)
  assert.equal(valorLiquidoEstimado({ valor: 1_000, receitaEsperada: null, tac: 150 }), null)
})

test('sem receita não há líquido — um traço é melhor que o valor cheio', () => {
  assert.equal(valorLiquidoEstimado({ valor: 1_000, receitaEsperada: null }), null)
  assert.equal(valorLiquidoEstimado({ valor: null, receitaEsperada: 10 }), null)
})

// ─── O piso de operação ─────────────────────────────────────────────────────

test('NF de R$ 500 ou menos não é operável — o limite é inclusivo', () => {
  assert.equal(abaixoDoMinimoOperavel(500), true)
  assert.equal(abaixoDoMinimoOperavel(499.99), true)
  assert.equal(abaixoDoMinimoOperavel(48), true)
  assert.equal(abaixoDoMinimoOperavel(500.01), false)
  assert.equal(abaixoDoMinimoOperavel(30_000), false)
})

test('valor ausente não esconde a nota: só a presença de um motivo desqualifica', () => {
  // Mesma regra da natureza vazia — ausência de informação não é motivo.
  assert.equal(abaixoDoMinimoOperavel(null), false)
  assert.equal(abaixoDoMinimoOperavel(undefined), false)
  assert.equal(abaixoDoMinimoOperavel(Number.NaN), false)
})

test('o piso é configurável, e o corte acompanha', () => {
  assert.equal(abaixoDoMinimoOperavel(800, 1_000), true)
  assert.equal(abaixoDoMinimoOperavel(800, 500), false)
})

test('o motivo é frase de tela, no formato do motivo de natureza', () => {
  assert.match(motivoValorAbaixoDoMinimo(500), /^Abaixo de R\$\s?500,00 — /)
})

test('o corte é pelo VALOR, não pelo líquido — e os dois NÃO coincidem', () => {
  // Uma NF de R$ 480 com uma TAC barata ainda dá líquido POSITIVO (R$ 203), e mesmo
  // assim não se opera: o piso é uma regra de negócio, não o resultado da conta.
  assert.equal(valorLiquidoEstimado({ valor: 480, receitaEsperada: 2, tac: 150, seguro: 125 }), 203)
  assert.equal(abaixoDoMinimoOperavel(480), true)

  // E o inverso também acontece: nota acima do piso pode ter líquido zero se a TAC
  // do sacado for cara. Essa segue operável — quem decide é a mesa, não o funil.
  assert.equal(valorLiquidoEstimado({ valor: 600, receitaEsperada: 5, tac: 500, seguro: 125 }), 0)
  assert.equal(abaixoDoMinimoOperavel(600), false)
})
