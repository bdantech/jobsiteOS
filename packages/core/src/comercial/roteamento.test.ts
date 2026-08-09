import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rotearNota, type NotaRoteavel, type OriginadorRoteavel } from './roteamento.ts'

/**
 * O que se protege aqui não é a busca — é a PRECEDÊNCIA e as três exclusões. Um
 * roteador que acerta 90% e entrega a nota errada nos 10% restantes é pior que a fila
 * sem dono: a fila alguém olha, a atribuição errada ninguém questiona.
 */

const NOTA: NotaRoteavel = {
  sacado_empresa_id: 'sac-1',
  fornecedor_empresa_id: 'forn-1',
  sacado_uf: 'SP',
  sacado_faturamento: 50_000_000,
  sacado_gestao: 'prospeccao_ativa',
}

const orig = (p: Partial<OriginadorRoteavel> & { vendedor_id: string }): OriginadorRoteavel => ({
  empresas_escolhidas: [],
  territorio: null,
  nfs_vivas: 0,
  ...p,
})

// ─── Precedência ────────────────────────────────────────────────────────────

test('carteira explícita vence território, mesmo com o territorial mais folgado', () => {
  const r = rotearNota(NOTA, [
    orig({ vendedor_id: 'carteira', empresas_escolhidas: ['sac-1'], nfs_vivas: 999 }),
    orig({ vendedor_id: 'territorial', territorio: { ufs: ['SP'], faturamento_min: null, faturamento_max: null }, nfs_vivas: 0 }),
  ])
  assert.equal(r.vendedor_id, 'carteira')
  assert.equal(r.origem, 'carteira')
})

test('a carteira casa pelo FORNECEDOR também, não só pelo sacado', () => {
  const r = rotearNota(NOTA, [orig({ vendedor_id: 'v1', empresas_escolhidas: ['forn-1'] })])
  assert.equal(r.vendedor_id, 'v1')
  assert.equal(r.origem, 'carteira')
})

test('território casa por UF e faixa; empate resolve por menor carga', () => {
  const t = { ufs: ['SP', 'MG'], faturamento_min: 10_000_000, faturamento_max: 100_000_000 }
  const r = rotearNota(NOTA, [
    orig({ vendedor_id: 'cheio', territorio: t, nfs_vivas: 40 }),
    orig({ vendedor_id: 'vazio', territorio: t, nfs_vivas: 3 }),
  ])
  assert.equal(r.vendedor_id, 'vazio')
  assert.equal(r.origem, 'territorio')
  assert.match(r.motivo, /desempate por carga/)
})

test('empate de carga é resolvido de forma REPRODUTÍVEL, não aleatória', () => {
  const t = { ufs: ['SP'], faturamento_min: null, faturamento_max: null }
  const lista = [orig({ vendedor_id: 'b', territorio: t }), orig({ vendedor_id: 'a', territorio: t })]
  // Duas chamadas, e a ordem da lista invertida: o dono tem de ser o mesmo. Um
  // roteador não determinístico faz a mesma nota trocar de dono a cada sync.
  assert.equal(rotearNota(NOTA, lista).vendedor_id, 'a')
  assert.equal(rotearNota(NOTA, [...lista].reverse()).vendedor_id, 'a')
})

test('sem originador que cubra, vai para a fila — e o motivo diz por quê', () => {
  const r = rotearNota(NOTA, [
    orig({ vendedor_id: 'sul', territorio: { ufs: ['RS'], faturamento_min: null, faturamento_max: null } }),
  ])
  assert.equal(r.vendedor_id, null)
  assert.match(r.motivo, /Nenhum originador cobre SP/)
})

// ─── As exclusões ───────────────────────────────────────────────────────────

test('sacado PASSIVO fica fora do roteamento inteiro', () => {
  // Passivo não é filtro visual: é a decisão de não trabalhar a conta. Rotear a NF
  // dela seria pedir trabalho de quem não vai ser comissionado por ele.
  const r = rotearNota(
    { ...NOTA, sacado_gestao: 'passivo' },
    [orig({ vendedor_id: 'v1', empresas_escolhidas: ['sac-1'] })],
  )
  assert.equal(r.vendedor_id, null)
  assert.match(r.motivo, /PASSIVA/)
})

test('atribuição manual do gestor não é revista pelo roteador', () => {
  const r = rotearNota(
    { ...NOTA, vendedor_id_atual: 'escolhido-a-mao', vendedor_origem_atual: 'manual' },
    [orig({ vendedor_id: 'outro', empresas_escolhidas: ['sac-1'] })],
  )
  assert.equal(r.vendedor_id, 'escolhido-a-mao')
  assert.equal(r.origem, 'manual')
})

test('território vazio não abocanha a base', () => {
  // Um originador recém-criado, com o cadastro de território em branco, casaria com
  // tudo se "sem restrição" fosse lido como "aceita qualquer coisa".
  const r = rotearNota(NOTA, [
    orig({ vendedor_id: 'novo', territorio: { ufs: [], faturamento_min: null, faturamento_max: null } }),
  ])
  assert.equal(r.vendedor_id, null)
})

test('faixa aberta de um lado continua sendo faixa', () => {
  const r = rotearNota(NOTA, [
    orig({ vendedor_id: 'grandes', territorio: { ufs: ['SP'], faturamento_min: 20_000_000, faturamento_max: null } }),
  ])
  assert.equal(r.vendedor_id, 'grandes')
})

test('faturamento desconhecido não entra em território com piso', () => {
  // Deixar entrar faria toda empresa sem estimativa cair no território dos grandes,
  // que é exatamente onde o erro custa mais caro.
  const r = rotearNota({ ...NOTA, sacado_faturamento: null }, [
    orig({ vendedor_id: 'grandes', territorio: { ufs: ['SP'], faturamento_min: 20_000_000, faturamento_max: null } }),
  ])
  assert.equal(r.vendedor_id, null)
})

test('duas carteiras reivindicando a mesma empresa entregam a nota E denunciam o cadastro', () => {
  const r = rotearNota(NOTA, [
    orig({ vendedor_id: 'a', empresas_escolhidas: ['sac-1'], nfs_vivas: 5 }),
    orig({ vendedor_id: 'b', empresas_escolhidas: ['sac-1'], nfs_vivas: 1 }),
  ])
  assert.equal(r.vendedor_id, 'b')
  assert.match(r.motivo, /2 originadores reivindicam/)
})
