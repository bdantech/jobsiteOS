import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CATALOGO,
  FiltroError,
  compileToPostgrest,
  compileToSql,
  descrever,
  parseArvore,
  type Grupo,
} from './filters.ts'

// A fixed "today" so the idade_anos derivation is deterministic.
const HOJE = new Date('2026-07-13T00:00:00Z')

// ─── The whitelist actually holds ───────────────────────────────────────────

test('rejeita variável que não está no catálogo', () => {
  assert.throws(
    () => compileToSql({ operador: 'e', condicoes: [{ variavel: 'senha', operador: 'igual', valor: 'x' }] }),
    FiltroError,
  )
})

test('rejeita variável que tenta ser uma expressão SQL', () => {
  const hostil = {
    operador: 'e',
    condicoes: [
      { variavel: 'capital_social; drop table empresas; --', operador: 'igual', valor: 1 },
    ],
  }
  assert.throws(() => compileToSql(hostil), FiltroError)
  assert.throws(() => compileToPostgrest(hostil), FiltroError)
})

test('rejeita operador que não se aplica ao tipo da variável', () => {
  // `contem` (ILIKE) sobre um número não faz sentido e abriria um cast implícito.
  assert.throws(
    () =>
      compileToSql({
        operador: 'e',
        condicoes: [{ variavel: 'capital_social', operador: 'contem', valor: '500' }],
      }),
    FiltroError,
  )
})

test('rejeita valor fora das opções de um enum', () => {
  assert.throws(
    () =>
      compileToSql({
        operador: 'e',
        condicoes: [{ variavel: 'camada', operador: 'igual', valor: 'presidente' }],
      }),
    FiltroError,
  )
})

test('rejeita número enviado como string', () => {
  assert.throws(
    () =>
      compileToSql({
        operador: 'e',
        condicoes: [{ variavel: 'capital_social', operador: 'maior_que', valor: '500000' }],
      }),
    FiltroError,
  )
})

// ─── Injeção: o valor NUNCA entra no texto do SQL ───────────────────────────

test('SQL: um valor hostil vira placeholder, nunca texto', () => {
  const { text, values } = compileToSql({
    operador: 'e',
    condicoes: [
      { variavel: 'razao_social' in {} ? 'uf' : 'uf', operador: 'igual', valor: "SP'; drop table empresas; --" },
    ],
  })

  assert.equal(text, '(uf = $1)')
  assert.deepEqual(values, ["SP'; drop table empresas; --"])
  // The payload must appear ONLY in values — nothing quotable reaches `text`.
  assert.ok(!text.includes('drop'))
  assert.ok(!text.includes("'"))
})

test('SQL: nenhum operador jamais concatena um literal', () => {
  // Exercise every operator and assert the emitted text has no quote characters
  // at all — the only way a value could have been interpolated.
  const arvore: Grupo = {
    operador: 'ou',
    condicoes: [
      { variavel: 'uf', operador: 'igual', valor: "a'b" },
      { variavel: 'uf', operador: 'diferente', valor: "a'b" },
      { variavel: 'uf', operador: 'contem', valor: "a'b" },
      { variavel: 'uf', operador: 'comeca_com', valor: "a'b" },
      { variavel: 'uf', operador: 'em', valor: ["a'b", "c'd"] },
      { variavel: 'uf', operador: 'nao_em', valor: ["a'b"] },
      { variavel: 'uf', operador: 'definido' },
      { variavel: 'uf', operador: 'nao_definido' },
      { variavel: 'capital_social', operador: 'maior_que', valor: 1 },
      { variavel: 'capital_social', operador: 'entre', valor: [1, 2] },
      { variavel: 'cnae_grupos' in {} ? 'cnae_grupo' : 'cnae_grupo', operador: 'contem_algum', valor: ["41'; --"] },
    ],
  }

  const { text, values } = compileToSql(arvore, HOJE)
  assert.ok(!text.includes("'"), `texto contém aspas: ${text}`)
  assert.ok(!text.includes('--'), `texto contém comentário SQL: ${text}`)
  assert.ok(values.length >= 9)
})

test('PostgREST: aspas e vírgulas no valor são escapadas, não viram sintaxe', () => {
  // A real razão social with a comma would otherwise be parsed as two conditions.
  const filtro = compileToPostgrest({
    operador: 'e',
    condicoes: [
      { variavel: 'razao_social' in {} ? 'municipio' : 'municipio', operador: 'igual', valor: 'SILVA, IRMÃOS & CIA (SP)' },
    ],
  })

  assert.equal(filtro, 'and(municipio.eq."SILVA, IRMÃOS & CIA (SP)")')
})

test('PostgREST: aspas duplas e barras no valor são escapadas', () => {
  const filtro = compileToPostgrest({
    operador: 'e',
    condicoes: [{ variavel: 'municipio', operador: 'igual', valor: 'a"b\\c' }],
  })
  assert.equal(filtro, 'and(municipio.eq."a\\"b\\\\c")')
})

// ─── Semântica dos operadores ───────────────────────────────────────────────

test('idade_anos inverte a comparação ao virar data', () => {
  // "3 anos ou mais de idade" ⇒ começou em 2023-07-13 OU ANTES.
  const { text, values } = compileToSql(
    { operador: 'e', condicoes: [{ variavel: 'idade_anos', operador: 'maior_ou_igual', valor: 3 }] },
    HOJE,
  )
  assert.equal(text, '(data_inicio_atividade <= $1)')
  assert.deepEqual(values, ['2023-07-13'])
})

test('idade_anos entre N e M vira um intervalo de datas invertido', () => {
  const { values } = compileToSql(
    { operador: 'e', condicoes: [{ variavel: 'idade_anos', operador: 'entre', valor: [3, 10] }] },
    HOJE,
  )
  // idade ∈ [3,10] ⇔ data_inicio ∈ [hoje-10, hoje-3]
  assert.deepEqual(values, ['2016-07-13', '2023-07-13'])
})

test('erp_conhecido vira um teste de nulidade sobre erp_atual', () => {
  const sim = compileToSql({
    operador: 'e',
    condicoes: [{ variavel: 'erp_conhecido', operador: 'igual', valor: true }],
  })
  assert.equal(sim.text, '(erp_atual is not null)')
  assert.deepEqual(sim.values, [])

  const nao = compileToSql({
    operador: 'e',
    condicoes: [{ variavel: 'erp_conhecido', operador: 'igual', valor: false }],
  })
  assert.equal(nao.text, '(erp_atual is null)')
})

test('nao_em também casa NULL (um ERP desconhecido não está em {sienge})', () => {
  // `col <> all(...)` is NULL for a NULL col, so the row would silently vanish.
  const { text } = compileToSql({
    operador: 'e',
    condicoes: [{ variavel: 'erp_atual', operador: 'nao_em', valor: ['sienge'] }],
  })
  // Outer parens = the group; inner = the null-guard the operator itself emits.
  assert.equal(text, '((erp_atual is null or erp_atual <> all($1)))')
})

test('diferente usa is distinct from, para não perder NULLs', () => {
  const { text } = compileToSql({
    operador: 'e',
    condicoes: [{ variavel: 'erp_atual', operador: 'diferente', valor: 'sienge' }],
  })
  assert.equal(text, '(erp_atual is distinct from $1)')
})

test('grupos aninhados preservam a precedência', () => {
  const { text } = compileToSql({
    operador: 'e',
    condicoes: [
      { variavel: 'situacao_cadastral', operador: 'igual', valor: 'ativa' },
      {
        operador: 'ou',
        condicoes: [
          { variavel: 'qtd_filiais', operador: 'maior_ou_igual', valor: 1 },
          { variavel: 'capital_social', operador: 'maior_ou_igual', valor: 2000000 },
        ],
      },
    ],
  })
  assert.equal(text, '(situacao_cadastral = $1 and (qtd_filiais >= $2 or capital_social >= $3))')
})

test('PostgREST monta and/or aninhados', () => {
  const filtro = compileToPostgrest({
    operador: 'e',
    condicoes: [
      { variavel: 'camada', operador: 'igual', valor: 'sam' },
      {
        operador: 'ou',
        condicoes: [
          { variavel: 'uf', operador: 'igual', valor: 'SP' },
          { variavel: 'uf', operador: 'igual', valor: 'SC' },
        ],
      },
    ],
  })
  assert.equal(filtro, 'and(camada.eq."sam",or(uf.eq."SP",uf.eq."SC"))')
})

test('contem_algum vira overlap de array nos dois compiladores', () => {
  const arvore = {
    operador: 'e',
    condicoes: [{ variavel: 'cnae_grupo', operador: 'contem_algum', valor: ['41', '42', '43'] }],
  }
  assert.equal(compileToSql(arvore).text, '(cnae_grupos && $1)')
  assert.equal(compileToPostgrest(arvore), 'and(cnae_grupos.ov.{"41","42","43"})')
})

test('contem usa o curinga certo em cada dialeto', () => {
  const arvore = {
    operador: 'e',
    condicoes: [{ variavel: 'razao_social' in {} ? 'municipio' : 'municipio', operador: 'contem', valor: 'jo' }],
  }
  assert.deepEqual(compileToSql(arvore).values, ['%jo%'])       // SQL: %
  assert.equal(compileToPostgrest(arvore), 'and(municipio.ilike."*jo*")') // PostgREST: *
})

// ─── Estrutura ──────────────────────────────────────────────────────────────

test('um grupo vazio é rejeitado', () => {
  assert.throws(() => parseArvore({ operador: 'e', condicoes: [] }), FiltroError)
})

test('entre exige exatamente dois valores', () => {
  assert.throws(
    () =>
      parseArvore({
        operador: 'e',
        condicoes: [{ variavel: 'capital_social', operador: 'entre', valor: [1] }],
      }),
    FiltroError,
  )
})

test('em exige uma lista não vazia', () => {
  assert.throws(
    () => parseArvore({ operador: 'e', condicoes: [{ variavel: 'uf', operador: 'em', valor: [] }] }),
    FiltroError,
  )
})

test('toda variável do catálogo tem coluna ou derivação', () => {
  for (const v of CATALOGO) {
    assert.ok(
      v.coluna || v.derivada,
      `"${v.id}" não tem coluna nem derivação — seria infiltrável`,
    )
  }
})

test('descrever produz texto legível em pt-BR', () => {
  const texto = descrever({
    operador: 'e',
    condicoes: [
      { variavel: 'situacao_cadastral', operador: 'igual', valor: 'ativa' },
      { variavel: 'idade_anos', operador: 'maior_ou_igual', valor: 3 },
    ],
  } as Grupo)
  assert.equal(texto, 'Situação cadastral é igual a ativa E Idade (anos) é maior ou igual a 3')
})
