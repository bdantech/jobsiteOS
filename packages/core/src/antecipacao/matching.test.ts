import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  casarAntecipacao,
  numerosParecidos,
  valorConfere,
  vencimentoConfere,
  type AntecipacaoParaCasar,
  type CandidataNf,
} from './matching.ts'

/**
 * Cada teste aqui é um jeito de casar a antecipação com a NF ERRADA. É a única
 * classe de bug deste módulo que ninguém percebe: a nota fica verde no funil, a
 * métrica por faixa conta uma conversão que não houve, e não há tela que
 * denuncie.
 */

const nf = (over: Partial<CandidataNf> & { access_key: string }): CandidataNf => ({
  numero: '84',
  valor: 42_800,
  vencimento: '2026-08-14',
  ...over,
})

const ant = (over: Partial<AntecipacaoParaCasar> = {}): AntecipacaoParaCasar => ({
  document_number: '84',
  gross_value: 42_800,
  original_due_date: '2026-08-14',
  ...over,
})

// ─── Match exato ────────────────────────────────────────────────────────────

test('número idêntico e candidata única casa como exata', () => {
  const r = casarAntecipacao(ant(), [nf({ access_key: 'A' })])
  assert.equal(r.status, 'casada')
  assert.equal(r.access_key, 'A')
  assert.equal(r.confianca, 'exata')
})

test('zeros à esquerda dos dois lados não impedem o match exato', () => {
  const r = casarAntecipacao(ant({ document_number: '0084' }), [nf({ access_key: 'A', numero: '84' })])
  assert.equal(r.status, 'casada')
  assert.equal(r.confianca, 'exata')
})

test('série embutida no documentNumber não impede o match', () => {
  const r = casarAntecipacao(ant({ document_number: '84/1' }), [nf({ access_key: 'A', numero: '84' })])
  assert.equal(r.status, 'casada')
  assert.equal(r.confianca, 'exata')
})

test('match exato ignora valor divergente — número idêntico e único basta', () => {
  // Não é descuido: quando o número bate e só existe UMA nota daquele par com
  // aquele número, um valor diferente quase sempre é retenção/desconto, não
  // outra nota.
  const r = casarAntecipacao(ant({ gross_value: 1 }), [nf({ access_key: 'A' })])
  assert.equal(r.status, 'casada')
  assert.equal(r.confianca, 'exata')
})

// ─── Múltiplas candidatas com o mesmo número ────────────────────────────────

test('mesmo número em duas séries: o valor desempata', () => {
  const r = casarAntecipacao(ant({ gross_value: 42_800 }), [
    nf({ access_key: 'A', valor: 42_800 }),
    nf({ access_key: 'B', valor: 9_000 }),
  ])
  assert.equal(r.status, 'casada')
  assert.equal(r.access_key, 'A')
  assert.equal(r.confianca, 'valor_confirmado')
})

test('mesmo número e mesmo valor nas duas: revisão, nunca escolha', () => {
  const r = casarAntecipacao(ant(), [
    nf({ access_key: 'A', valor: 42_800 }),
    nf({ access_key: 'B', valor: 42_800 }),
  ])
  assert.equal(r.status, 'revisao')
  assert.equal(r.access_key, null)
  assert.deepEqual(r.candidatas.sort(), ['A', 'B'])
})

test('mesmo número e NENHUMA com o valor: revisão, não a primeira da lista', () => {
  const r = casarAntecipacao(ant({ gross_value: 1_000 }), [
    nf({ access_key: 'A', valor: 42_800 }),
    nf({ access_key: 'B', valor: 9_000 }),
  ])
  assert.equal(r.status, 'revisao')
  assert.equal(r.access_key, null)
})

// ─── Zeros à direita: o caso que a normalização NÃO resolve ─────────────────

test('84 não casa com 840 sem confirmação de valor E vencimento', () => {
  const r = casarAntecipacao(ant({ document_number: '84', gross_value: 1_000 }), [
    nf({ access_key: 'A', numero: '840', valor: 42_800 }),
  ])
  assert.equal(r.status, 'revisao')
  assert.equal(r.access_key, null)
  assert.equal(r.motivo, 'numero_aproximado_sem_confirmacao')
})

test('84 casa com 840 quando valor E vencimento confirmam', () => {
  const r = casarAntecipacao(ant({ document_number: '84' }), [
    nf({ access_key: 'A', numero: '840', valor: 42_800, vencimento: '2026-08-14' }),
  ])
  assert.equal(r.status, 'casada')
  assert.equal(r.access_key, 'A')
  assert.equal(r.confianca, 'valor_confirmado')
})

test('valor bate mas vencimento não: revisão — uma guarda só não confirma', () => {
  const r = casarAntecipacao(ant({ document_number: '84' }), [
    nf({ access_key: 'A', numero: '840', valor: 42_800, vencimento: '2026-09-30' }),
  ])
  assert.equal(r.status, 'revisao')
})

test('vencimento ausente na NF não confirma — "não sei" não é "bate"', () => {
  const r = casarAntecipacao(ant({ document_number: '84' }), [
    nf({ access_key: 'A', numero: '840', vencimento: null }),
  ])
  assert.equal(r.status, 'revisao')
})

test('duas aproximadas confirmadas viram revisão, não a de menor número', () => {
  const r = casarAntecipacao(ant({ document_number: '84' }), [
    nf({ access_key: 'A', numero: '840' }),
    nf({ access_key: 'B', numero: '8400' }),
  ])
  assert.equal(r.status, 'revisao')
  assert.equal(r.motivo, 'numero_aproximado_ambiguo')
  assert.deepEqual(r.candidatas.sort(), ['A', 'B'])
})

// ─── Sem candidata ──────────────────────────────────────────────────────────

test('par sem nota nenhuma é sem_nf — a NF pode não ter chegado ainda', () => {
  const r = casarAntecipacao(ant(), [])
  assert.equal(r.status, 'sem_nf')
  assert.equal(r.motivo, 'sem_candidatas')
})

test('par com notas, nenhuma parecida, é sem_nf e não revisão', () => {
  const r = casarAntecipacao(ant({ document_number: '84' }), [
    nf({ access_key: 'A', numero: '99312' }),
  ])
  assert.equal(r.status, 'sem_nf')
  assert.equal(r.motivo, 'nenhuma_parecida')
})

test('antecipação sem número vai para revisão, nunca casa por valor', () => {
  const r = casarAntecipacao(ant({ document_number: null }), [nf({ access_key: 'A' })])
  assert.equal(r.status, 'revisao')
  assert.equal(r.motivo, 'sem_numero')
})

test('NF sem número não entra na comparação e não derruba as outras', () => {
  const r = casarAntecipacao(ant(), [nf({ access_key: 'A', numero: null }), nf({ access_key: 'B' })])
  assert.equal(r.status, 'casada')
  assert.equal(r.access_key, 'B')
})

// ─── Tolerâncias ────────────────────────────────────────────────────────────

test('tolerância de valor é 1% e é relativa ao maior', () => {
  assert.equal(valorConfere(100_000, 100_900, 1), true)
  assert.equal(valorConfere(100_000, 101_100, 1), false)
  assert.equal(valorConfere(0, 0, 1), false)
  assert.equal(valorConfere(null, 100, 1), false)
})

test('tolerância de vencimento é ±5 dias, inclusive', () => {
  assert.equal(vencimentoConfere('2026-08-14', '2026-08-19', 5), true)
  assert.equal(vencimentoConfere('2026-08-14', '2026-08-09', 5), true)
  assert.equal(vencimentoConfere('2026-08-14', '2026-08-20', 5), false)
  assert.equal(vencimentoConfere('2026-08-14', null, 5), false)
})

test('parecidos é relação de prefixo com no máximo 3 dígitos de diferença', () => {
  assert.equal(numerosParecidos('84', '840'), true)
  assert.equal(numerosParecidos('8821', '88210'), true)
  assert.equal(numerosParecidos('84', '84000'), true)
  assert.equal(numerosParecidos('84', '840000'), false)
  assert.equal(numerosParecidos('84', '94'), false)
  assert.equal(numerosParecidos('184', '84'), false)
})

// ─── A guarda que o motor NÃO faz ───────────────────────────────────────────

test('o par fornecedor↔sacado não é conferido aqui — é premissa da lista', () => {
  // Documenta a fronteira: quem consulta o banco recorta por fornecedor e
  // sacado. Se um dia alguém passar candidatas de outro par, o motor casa — e é
  // por isso que a consulta e o motor nunca podem ser separados sem este aviso.
  const r = casarAntecipacao(ant(), [nf({ access_key: 'DE_OUTRO_PAR' })])
  assert.equal(r.status, 'casada')
})
