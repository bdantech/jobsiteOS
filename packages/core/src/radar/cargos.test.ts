import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ordenarPorAlvo, type CandidatoCargo } from './cargos.ts'

/**
 * O que estes testes protegem é o corte pago: o worker ordena e então fatia em
 * `max_contatos_por_empresa`, e cada item da fatia custa dinheiro. Uma regressão
 * aqui não derruba nada — só troca CFO por gerente de obra na fatura.
 */

const ALVO = {
  senioridades: ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director', 'manager'],
  departamentos: ['finance', 'operations', 'engineering', 'procurement', 'executive'],
}

const cargos = (ps: CandidatoCargo[]): Array<string | undefined> =>
  ordenarPorAlvo(ps, ALVO).map((p) => p.seniority)

test('senioridade manda: a ordem do settings vira a ordem da fila', () => {
  const entrada: CandidatoCargo[] = [
    { seniority: 'manager' },
    { seniority: 'c_suite' },
    { seniority: 'director' },
    { seniority: 'owner' },
  ]
  assert.deepEqual(cargos(entrada), ['owner', 'c_suite', 'director', 'manager'])
})

test('o caso real: com 4 slots, CFO e sócio entram antes de Construction Manager', () => {
  // Ordem de entrada = a que o Apollo devolveu para ribeirocaram.com.br.
  const doApollo: Array<CandidatoCargo & { cargo: string }> = [
    { cargo: 'Construction Manager', seniority: 'manager', departments: ['master_operations'] },
    { cargo: 'Construction Manager', seniority: 'manager', departments: ['master_operations'] },
    { cargo: 'CFO', seniority: 'c_suite', departments: ['c_suite'] },
    { cargo: 'Diretor Financeiro do Grupo', seniority: 'director', departments: ['master_finance'] },
  ]
  const pagos = ordenarPorAlvo(doApollo, ALVO)
    .slice(0, 2)
    .map((p) => p.cargo)
  assert.deepEqual(pagos, ['CFO', 'Diretor Financeiro do Grupo'])
})

test('departamento desempata dentro da mesma senioridade', () => {
  const entrada: Array<CandidatoCargo & { id: string }> = [
    { id: 'vendas', seniority: 'director', departments: ['master_sales'] },
    { id: 'financeiro', seniority: 'director', departments: ['master_finance'] },
  ]
  assert.deepEqual(
    ordenarPorAlvo(entrada, ALVO).map((p) => p.id),
    ['financeiro', 'vendas'],
  )
})

test('o prefixo master_ do Apollo casa com o termo curto do settings', () => {
  const entrada: Array<CandidatoCargo & { id: string }> = [
    { id: 'fora', seniority: 'manager', departments: ['master_sales'] },
    { id: 'engenharia', seniority: 'manager', departments: ['master_engineering_technical'] },
  ]
  assert.deepEqual(
    ordenarPorAlvo(entrada, ALVO).map((p) => p.id),
    ['engenharia', 'fora'],
  )
})

test('sócio sem departamento não é rebaixado por causa disso', () => {
  // O bug que um filtro por departamento causaria: `departments` vazio é comum
  // justamente em owner/partner, os alvos mais valiosos.
  const entrada: Array<CandidatoCargo & { id: string }> = [
    { id: 'gerente', seniority: 'manager', departments: ['master_finance'] },
    { id: 'socio', seniority: 'owner' },
  ]
  assert.deepEqual(
    ordenarPorAlvo(entrada, ALVO).map((p) => p.id),
    ['socio', 'gerente'],
  )
})

test('senioridade desconhecida ou ausente vai para o fim', () => {
  const entrada: Array<CandidatoCargo & { id: string }> = [
    { id: 'estagiario', seniority: 'entry' },
    { id: 'sem', departments: ['master_finance'] },
    { id: 'gerente', seniority: 'manager' },
  ]
  const ids = ordenarPorAlvo(entrada, ALVO).map((p) => p.id)
  assert.equal(ids[0], 'gerente')
  assert.equal(ids.length, 3)
})

test('não muta a lista recebida', () => {
  const entrada: CandidatoCargo[] = [{ seniority: 'manager' }, { seniority: 'owner' }]
  ordenarPorAlvo(entrada, ALVO)
  assert.deepEqual(
    entrada.map((p) => p.seniority),
    ['manager', 'owner'],
  )
})
