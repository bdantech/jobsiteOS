import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  closerParaConta,
  cobreTerritorio,
  rotearNota,
  type CloserComTerritorio,
  type NotaRoteavel,
  type OriginadorRoteavel,
} from './roteamento.ts'

/**
 * O que se protege aqui é a SEPARAÇÃO entre as duas atribuições, mais as exclusões.
 *
 * Originador trabalha NOTA e a recebe por escolha explícita; closer trabalha CONTA e a
 * recebe por recorte de UF e faturamento. Uma versão anterior usava território para
 * rotear nota, o que trocava as duas de lugar — os dois primeiros testes existem para
 * que isso não volte.
 */

const NOTA: NotaRoteavel = {
  sacado_empresa_id: 'sac-1',
  fornecedor_empresa_id: 'forn-1',
  sacado_gestao: 'prospeccao_ativa',
}

const orig = (p: Partial<OriginadorRoteavel> & { vendedor_id: string }): OriginadorRoteavel => ({
  empresas_escolhidas: [],
  nfs_vivas: 0,
  ...p,
})

// ─── Nota: só carteira explícita ────────────────────────────────────────────

test('a nota vai para quem tem a empresa na carteira', () => {
  const r = rotearNota(NOTA, [orig({ vendedor_id: 'v1', empresas_escolhidas: ['sac-1'] })])
  assert.equal(r.vendedor_id, 'v1')
  assert.equal(r.origem, 'carteira')
})

test('a carteira casa pelo FORNECEDOR também, não só pelo sacado', () => {
  const r = rotearNota(NOTA, [orig({ vendedor_id: 'v1', empresas_escolhidas: ['forn-1'] })])
  assert.equal(r.vendedor_id, 'v1')
})

test('sem carteira que cubra, vai para a fila — território NÃO roteia nota', () => {
  // Território é a régua do closer. Usá-lo aqui faria o originador receber conta por
  // região, que é exatamente a inversão que este arquivo corrigiu.
  const r = rotearNota(NOTA, [orig({ vendedor_id: 'territorial' })])
  assert.equal(r.vendedor_id, null)
  assert.match(r.motivo, /carteira/)
})

test('empate de carteira entrega a nota E denuncia o cadastro', () => {
  const r = rotearNota(NOTA, [
    orig({ vendedor_id: 'a', empresas_escolhidas: ['sac-1'], nfs_vivas: 5 }),
    orig({ vendedor_id: 'b', empresas_escolhidas: ['sac-1'], nfs_vivas: 1 }),
  ])
  assert.equal(r.vendedor_id, 'b')
  assert.match(r.motivo, /2 originadores reivindicam/)
})

test('empate de carga é resolvido de forma REPRODUTÍVEL, não aleatória', () => {
  const lista = [
    orig({ vendedor_id: 'b', empresas_escolhidas: ['sac-1'] }),
    orig({ vendedor_id: 'a', empresas_escolhidas: ['sac-1'] }),
  ]
  // Um roteador não determinístico faz a mesma nota trocar de dono a cada sync.
  assert.equal(rotearNota(NOTA, lista).vendedor_id, 'a')
  assert.equal(rotearNota(NOTA, [...lista].reverse()).vendedor_id, 'a')
})

// ─── As exclusões ───────────────────────────────────────────────────────────

test('sacado PASSIVO fica fora do roteamento inteiro', () => {
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

// ─── Conta: o território é do closer ────────────────────────────────────────

const closer = (p: Partial<CloserComTerritorio> & { vendedor_id: string }): CloserComTerritorio => ({
  territorio: null,
  vendas_vivas: 0,
  ...p,
})

const CONTA = { uf: 'SP', faturamento: 50_000_000 }

test('o closer é escolhido por UF e faixa de faturamento', () => {
  const r = closerParaConta(CONTA, [
    closer({ vendedor_id: 'sul', territorio: { ufs: ['RS'], faturamento_min: null, faturamento_max: null } }),
    closer({ vendedor_id: 'sudeste', territorio: { ufs: ['SP', 'MG'], faturamento_min: 10_000_000, faturamento_max: 100_000_000 } }),
  ])
  assert.equal(r?.vendedor_id, 'sudeste')
})

test('dois closers no mesmo recorte: desempate por carga', () => {
  const t = { ufs: ['SP'], faturamento_min: null, faturamento_max: null }
  const r = closerParaConta(CONTA, [
    closer({ vendedor_id: 'cheio', territorio: t, vendas_vivas: 12 }),
    closer({ vendedor_id: 'vazio', territorio: t, vendas_vivas: 2 }),
  ])
  assert.equal(r?.vendedor_id, 'vazio')
  assert.match(r?.motivo ?? '', /desempate por carga/)
})

test('ninguém cobre: devolve null em vez de inventar um dono', () => {
  // A tela mostra a lista inteira nesse caso. Escolher "o mais parecido" seria um
  // palpite com cara de regra.
  const r = closerParaConta(CONTA, [
    closer({ vendedor_id: 'sul', territorio: { ufs: ['RS'], faturamento_min: null, faturamento_max: null } }),
  ])
  assert.equal(r, null)
})

test('território vazio não abocanha todas as contas', () => {
  assert.equal(cobreTerritorio(CONTA, { ufs: [], faturamento_min: null, faturamento_max: null }), false)
  assert.equal(closerParaConta(CONTA, [closer({ vendedor_id: 'novo', territorio: { ufs: [], faturamento_min: null, faturamento_max: null } })]), null)
})

test('faixa aberta de um lado continua sendo faixa', () => {
  assert.equal(
    cobreTerritorio(CONTA, { ufs: ['SP'], faturamento_min: 20_000_000, faturamento_max: null }),
    true,
  )
})

test('faturamento desconhecido não entra em território com piso', () => {
  // Deixar entrar faria toda empresa sem estimativa cair no closer dos grandes, que é
  // onde o erro custa mais caro.
  assert.equal(
    cobreTerritorio({ uf: 'SP', faturamento: null }, { ufs: ['SP'], faturamento_min: 20_000_000, faturamento_max: null }),
    false,
  )
  // Mas um território só de UF aceita: não perguntou por faturamento.
  assert.equal(
    cobreTerritorio({ uf: 'SP', faturamento: null }, { ufs: ['SP'], faturamento_min: null, faturamento_max: null }),
    true,
  )
})

// ─── A conta é a holding E as SPEs dela ─────────────────────────────────────
//
// O caso que motivou tudo: uma construtora fatura contra a SPE da obra, não contra o
// CNPJ dela. Medido no banco antes da mudança: 3.148 notas vivas contra clientes e
// outras 1.112 contra SPEs desses mesmos clientes, que nunca chegavam a ninguém.

/** Nota emitida contra a SPE de um grupo — a SPE não está na carteira de ninguém. */
const NOTA_SPE: NotaRoteavel = {
  sacado_empresa_id: 'spe-obra-7',
  fornecedor_empresa_id: 'forn-1',
  sacado_grupo_spe: 'grupo-pride',
  sacado_gestao: 'prospeccao_ativa',
}

test('a nota da SPE vai para quem escolheu a HOLDING dela', () => {
  const r = rotearNota(NOTA_SPE, [
    orig({ vendedor_id: 'v1', empresas_escolhidas: ['holding-pride'], grupos_escolhidos: ['grupo-pride'] }),
  ])
  assert.equal(r.vendedor_id, 'v1')
  assert.match(r.motivo, /SPE de uma holding/)
})

test('grupo que ninguém escolheu não roteia — não basta ser SPE de alguém', () => {
  const r = rotearNota(NOTA_SPE, [
    orig({ vendedor_id: 'v1', empresas_escolhidas: ['holding-outra'], grupos_escolhidos: ['grupo-outro'] }),
  ])
  assert.equal(r.vendedor_id, null)
})

test('originador sem grupos_escolhidos não regride — só não alcança SPE', () => {
  // O campo é opcional: um chamador antigo continua roteando pela carteira direta.
  const r = rotearNota(NOTA_SPE, [orig({ vendedor_id: 'v1', empresas_escolhidas: ['spe-obra-7'] })])
  assert.equal(r.vendedor_id, 'v1')
  assert.match(r.motivo, /Carteira explícita do originador/)
})

test('quem tem a empresa DIRETO ganha de quem a alcança pela SPE', () => {
  /*
   * Um grupo pode ter dois clientes, e a SPE de um pode ser sacada numa nota cujo
   * fornecedor é o outro. Sem a precedência, a nota iria para o dono do grupo em vez do
   * dono da empresa escrita nela — e o vendedor veria o nome do próprio cliente na nota
   * sem entender por que ela não é dele.
   */
  const r = rotearNota(NOTA_SPE, [
    orig({ vendedor_id: 'do-grupo', grupos_escolhidos: ['grupo-pride'], nfs_vivas: 0 }),
    orig({ vendedor_id: 'do-fornecedor', empresas_escolhidas: ['forn-1'], nfs_vivas: 99 }),
  ])
  // Vence mesmo com carga muito maior: precedência não é desempate.
  assert.equal(r.vendedor_id, 'do-fornecedor')
  assert.match(r.motivo, /Carteira explícita do originador/)
})

test('sacado passivo continua fora, e o rótulo vem da holding', () => {
  // A SPE não tem gestão própria; quem carrega o passivo é a holding. Ler o campo da SPE
  // devolveria nulo e a nota entraria em carteira como se a conta fosse ativa.
  const r = rotearNota(
    { ...NOTA_SPE, sacado_gestao: 'passivo' },
    [orig({ vendedor_id: 'v1', empresas_escolhidas: ['holding-pride'], grupos_escolhidos: ['grupo-pride'] })],
  )
  assert.equal(r.vendedor_id, null)
  assert.match(r.motivo, /PASSIVA/)
})

test('duas holdings do mesmo grupo em carteiras diferentes: entrega uma e denuncia', () => {
  const r = rotearNota(NOTA_SPE, [
    orig({ vendedor_id: 'a', grupos_escolhidos: ['grupo-pride'], nfs_vivas: 5 }),
    orig({ vendedor_id: 'b', grupos_escolhidos: ['grupo-pride'], nfs_vivas: 1 }),
  ])
  assert.equal(r.vendedor_id, 'b')
  assert.match(r.motivo, /2 originadores reivindicam/)
})
