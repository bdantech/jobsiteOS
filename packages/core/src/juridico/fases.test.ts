import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REGRAS_FASE_PADRAO,
  classificarMovimentacao,
  montarCronograma,
  normalizarTexto,
} from './fases.ts'
import { BENCHMARK_FASES_PADRAO, formatarCnj, ordemDaFase } from './schemas.ts'

test('normaliza acento, caixa e espaço', () => {
  assert.equal(normalizarTexto('  CITAÇÃO   Válida\nefetivada '), 'citacao valida efetivada')
})

test('classifica a fase pela palavra-chave', () => {
  assert.equal(classificarMovimentacao('Expedido mandado de citação').fase, 'citacao')
  assert.equal(classificarMovimentacao('AUTO DE PENHORA lavrado').fase, 'penhora')
  assert.equal(classificarMovimentacao('Certidão de trânsito em julgado').fase, 'transito_julgado')
})

test('exceção anula o casamento', () => {
  // "Citação negativa" contém "citacao" e é o CONTRÁRIO do marco.
  assert.equal(classificarMovimentacao('Certidão de citação negativa do réu').fase, null)
  // Bloqueio infrutífero NÃO é penhora — mas ainda é execução: a tentativa prova que o
  // cumprimento começou. A exceção tira a fase errada sem apagar a que de fato ocorreu.
  assert.equal(
    classificarMovimentacao('Bloqueio infrutífero — penhora online').fase,
    'cumprimento_execucao',
  )
  assert.equal(classificarMovimentacao('Deixo de designar audiência de instrução').fase, null)
})

test('duas regras no mesmo texto: vence a mais avançada', () => {
  const r = classificarMovimentacao(
    'Sentença publicada; intimação para pagamento em cumprimento de sentença',
  )
  assert.equal(r.fase, 'cumprimento_execucao')
  assert.ok(ordemDaFase(r.fase!) > ordemDaFase('sentenca'))
})

test('movimentação sem termo conhecido não classifica nada', () => {
  const r = classificarMovimentacao('Juntada de petição diversa')
  assert.equal(r.fase, null)
  assert.equal(r.relevante, false)
  assert.equal(r.termo, null)
})

test('marca relevante só o que a régua marcou', () => {
  assert.equal(classificarMovimentacao('Auto de penhora').relevante, true)
  assert.equal(classificarMovimentacao('Interposta apelação').relevante, false)
})

test('regras customizadas substituem as padrão', () => {
  const regras = [{ fase: 'sentenca' as const, termos: ['despacho saneador final'] }]
  assert.equal(classificarMovimentacao('Auto de penhora', regras).fase, null)
  assert.equal(classificarMovimentacao('DESPACHO SANEADOR FINAL', regras).fase, 'sentenca')
})

test('toda regra padrão aponta para uma fase da régua', () => {
  for (const r of REGRAS_FASE_PADRAO) assert.ok(ordemDaFase(r.fase) >= 0, r.fase)
})

// ─── Cronograma ─────────────────────────────────────────────────────────────

const HOJE = new Date('2026-08-28T12:00:00Z')

test('cronograma mede o tempo em cada fase e o total', () => {
  const c = montarCronograma(
    [
      { data: '2026-01-01', fase_detectada: 'distribuicao' },
      { data: '2026-02-10', fase_detectada: 'citacao' },
      { data: '2026-03-12', fase_detectada: 'contestacao_embargos' },
    ],
    BENCHMARK_FASES_PADRAO,
    HOJE,
  )
  assert.equal(c.etapas.length, 3)
  assert.equal(c.etapas[0]!.dias, 40)
  assert.equal(c.etapas[1]!.dias, 30)
  assert.equal(c.fase_atual, 'contestacao_embargos')
  assert.equal(c.fase_desde, '2026-03-12')
  assert.equal(c.dias_total, 239)
})

test('a fase NÃO retrocede: movimentação anterior depois da penhora é ignorada', () => {
  const c = montarCronograma(
    [
      { data: '2026-01-01', fase_detectada: 'distribuicao' },
      { data: '2026-05-01', fase_detectada: 'penhora' },
      { data: '2026-06-01', fase_detectada: 'instrucao' },
    ],
    BENCHMARK_FASES_PADRAO,
    HOJE,
  )
  assert.equal(c.fase_atual, 'penhora')
  assert.equal(c.etapas.length, 2)
})

test('movimentações fora de ordem são ordenadas antes de contar tempo', () => {
  const c = montarCronograma(
    [
      { data: '2026-02-10', fase_detectada: 'citacao' },
      { data: '2026-01-01', fase_detectada: 'distribuicao' },
    ],
    BENCHMARK_FASES_PADRAO,
    HOJE,
  )
  assert.equal(c.etapas[0]!.fase, 'distribuicao')
  assert.equal(c.etapas[0]!.dias, 40)
})

test('repetir a mesma fase não reinicia o relógio', () => {
  const c = montarCronograma(
    [
      { data: '2026-01-01', fase_detectada: 'citacao' },
      { data: '2026-07-01', fase_detectada: 'citacao' },
    ],
    BENCHMARK_FASES_PADRAO,
    HOJE,
  )
  assert.equal(c.etapas.length, 1)
  assert.equal(c.fase_desde, '2026-01-01')
  assert.ok(c.dias_na_fase_atual > 200)
})

test('estouro do benchmark na fase atual acende o alerta', () => {
  // Citação tem benchmark de 60 dias; aqui estamos há ~200.
  const c = montarCronograma(
    [{ data: '2026-02-10', fase_detectada: 'citacao' }],
    BENCHMARK_FASES_PADRAO,
    HOJE,
  )
  assert.equal(c.lenta, true)
  assert.equal(c.etapas[0]!.estourou, true)
})

test('sem movimentação classificada, o cronograma é vazio e não é lento', () => {
  const c = montarCronograma([{ data: '2026-01-01', fase_detectada: null }], BENCHMARK_FASES_PADRAO, HOJE)
  assert.deepEqual(c.etapas, [])
  assert.equal(c.fase_atual, null)
  assert.equal(c.lenta, false)
})

// ─── CNJ ────────────────────────────────────────────────────────────────────

test('formata o CNJ colado sem máscara e preserva o já mascarado', () => {
  assert.equal(formatarCnj('00000700720268190001'), '0000070-07.2026.8.19.0001')
  assert.equal(formatarCnj('0000070-07.2026.8.19.0001'), '0000070-07.2026.8.19.0001')
  // Número incompleto volta como veio: inventar máscara esconderia o erro de digitação.
  assert.equal(formatarCnj('123'), '123')
})
