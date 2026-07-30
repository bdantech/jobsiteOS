import assert from 'node:assert/strict'
import { test } from 'node:test'
import { criarContatoSchema } from './index.ts'

/**
 * O contato manual é a única escrita de `contatos` que vem de formulário, e
 * formulário manda string vazia em todo campo que o usuário não tocou. Se '' passar
 * para o banco, a lista de contatos ganha linhas com nome vazio que ainda concorrem
 * a ponto focal — que é exatamente a heurística que o ponto focal existe para
 * corrigir.
 */

const EMPRESA = '00000000-0000-4000-8000-000000000000'

test('string vazia vira null, não fica no banco como texto vazio', () => {
  const r = criarContatoSchema.parse({
    empresa_id: EMPRESA,
    nome: 'Maria Silva',
    cargo: '',
    email: '',
    telefone: '',
    whatsapp: '',
    linkedin_url: '',
  })
  assert.equal(r.nome, 'Maria Silva')
  assert.equal(r.cargo, null)
  assert.equal(r.email, null)
  assert.equal(r.telefone, null)
})

test('campos ausentes viram null', () => {
  const r = criarContatoSchema.parse({ empresa_id: EMPRESA, telefone: '(11) 3000-0000' })
  assert.equal(r.nome, null)
  assert.equal(r.email, null)
  assert.equal(r.telefone, '(11) 3000-0000')
})

test('exige ao menos uma forma de contato', () => {
  const r = criarContatoSchema.safeParse({ empresa_id: EMPRESA, cargo: 'Diretor' })
  assert.equal(r.success, false)
  if (!r.success) {
    assert.match(r.error.issues[0]?.message ?? '', /ao menos nome, e-mail, telefone/)
    // A mensagem tem de cair sob `nome` para o formulário conseguir mostrá-la.
    assert.deepEqual(r.error.issues[0]?.path, ['nome'])
  }
})

test('qualquer um dos quatro basta', () => {
  for (const campo of ['nome', 'email', 'telefone', 'whatsapp']) {
    const valor = campo === 'email' ? 'a@b.com' : 'algum valor'
    assert.equal(criarContatoSchema.safeParse({ empresa_id: EMPRESA, [campo]: valor }).success, true, campo)
  }
})

test('e-mail inválido é recusado, mas vazio é aceito como ausente', () => {
  assert.equal(
    criarContatoSchema.safeParse({ empresa_id: EMPRESA, nome: 'X', email: 'não-é-email' }).success,
    false,
  )
  assert.equal(criarContatoSchema.safeParse({ empresa_id: EMPRESA, nome: 'X', email: '' }).success, true)
})

test('espaços em volta são removidos', () => {
  const r = criarContatoSchema.parse({ empresa_id: EMPRESA, nome: '  Maria  ', telefone: '  11  ' })
  assert.equal(r.nome, 'Maria')
  assert.equal(r.telefone, '11')
})

test('empresa_id tem de ser uuid', () => {
  assert.equal(criarContatoSchema.safeParse({ empresa_id: 'abc', nome: 'X' }).success, false)
})

test('só espaços não conta como forma de contato', () => {
  assert.equal(criarContatoSchema.safeParse({ empresa_id: EMPRESA, nome: '   ' }).success, false)
})
