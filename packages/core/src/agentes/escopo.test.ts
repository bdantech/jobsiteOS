import assert from 'node:assert/strict'
import { test } from 'node:test'
import { arvoreEfetiva, combinarArvores, entraNaDistribuicao, whereDaArvore } from './escopo.ts'

const SP = { operador: 'e' as const, condicoes: [{ variavel: 'uf', operador: 'igual' as const, valor: 'SP' }] }
const PILOTO = { operador: 'e' as const, condicoes: [{ variavel: 'porte', operador: 'igual' as const, valor: 'EPP' }] }

test('piloto entra POR CIMA do escopo só em modo piloto', () => {
  const escopo = { modo: 'filtro' as const, filtro: SP, piloto: PILOTO }
  const piloto = arvoreEfetiva(escopo, 'piloto', 'empresas')
  assert.deepEqual(piloto, { operador: 'e', condicoes: [SP, PILOTO] })
  const pleno = arvoreEfetiva(escopo, 'pleno', 'empresas')
  assert.deepEqual(pleno, SP)
})

test('a regra entra em E com o escopo; sem nada, não há árvore (e o SQL diz `true`)', () => {
  const regra = { operador: 'e' as const, condicoes: [{ variavel: 'dias_sem_conversa', operador: 'maior_que' as const, valor: 30 }] }
  const r = arvoreEfetiva({ modo: 'filtro', filtro: SP }, 'pleno', 'empresas', regra)
  assert.equal(r?.condicoes.length, 2)
  assert.equal(arvoreEfetiva(null, 'pleno', 'empresas'), null)
  assert.deepEqual(whereDaArvore('empresas', null), { text: 'true', values: [] })
  assert.equal(combinarArvores(null, null), null)
})

test('árvore de empresas compila para SQL com valores em parâmetro, nunca interpolados', () => {
  const w = whereDaArvore('empresas', SP)
  assert.match(w.text, /uf/)
  assert.deepEqual(w.values, ['SP'])
})

test('variável fora do catálogo da população é recusada', () => {
  const nf = { operador: 'e' as const, condicoes: [{ variavel: 'dias_para_vencimento', operador: 'maior_que' as const, valor: 10 }] }
  // dias_para_vencimento existe nas NOTAS, não nas empresas.
  assert.throws(() => arvoreEfetiva({ modo: 'filtro', filtro: nf }, 'pleno', 'empresas'))
  assert.ok(arvoreEfetiva({ modo: 'filtro', filtro_nf: nf }, 'pleno', 'notas'))
})

test('IA fora da distribuição padrão; só entra no modo carteira com o modo liberado (§1.9)', () => {
  assert.equal(entraNaDistribuicao({ is_ia: false }, false), true)
  assert.equal(entraNaDistribuicao({ is_ia: true, escopo: { modo: 'filtro' } }, true), false)
  assert.equal(entraNaDistribuicao({ is_ia: true, escopo: { modo: 'carteira' } }, false), false)
  assert.equal(entraNaDistribuicao({ is_ia: true, escopo: { modo: 'carteira' } }, true), true)
})
