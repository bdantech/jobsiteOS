import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calcularScore, chanceDaFaixa, pontosDaFaixa, type DefinicaoScorecard, type ParametrosScore } from './score.ts'

const DEF: DefinicaoScorecard = {
  fatores: {
    protestos: {
      peso: 25,
      faixas: [
        { ate: 0, pontos: 25 },
        { ate: 0.005, pontos: 15 },
        { ate: 0.02, pontos: 5 },
        { ate: null, pontos: 0 },
      ],
      recencia_divisor: 2,
    },
    faturamento: {
      peso: 15,
      faixas: [
        { ate: 1_000_000, pontos: 2 },
        { ate: 4_800_000, pontos: 5 },
        { ate: 10_000_000, pontos: 8 },
        { ate: 50_000_000, pontos: 12 },
        { ate: null, pontos: 15 },
      ],
    },
    atividade_grupo: { peso: 15, casos: { forte: 15, fraca: 8, zerada: 3 } },
    idade: {
      peso: 10,
      faixas: [
        { ate: 2, pontos: 0 },
        { ate: 5, pontos: 4 },
        { ate: 10, pontos: 7 },
        { ate: null, pontos: 10 },
      ],
    },
    regularidade: { peso: 10, casos: { limpa: 10, com_historico: 4 } },
    historico_analises: {
      peso: 10,
      casos: { aprovada_vigente: 10, aprovada_expirada: 7, nunca: 5, aprovada_parcial: 4 },
    },
    crescimento_headcount: {
      peso: 5,
      faixas: [
        { ate: -0.15, pontos: 0 },
        { ate: 0.15, pontos: 3 },
        { ate: null, pontos: 5 },
      ],
    },
    capital_social: {
      peso: 5,
      faixas: [
        { ate: 1_000_000, pontos: 1 },
        { ate: 5_000_000, pontos: 3 },
        { ate: null, pontos: 5 },
      ],
    },
    certificado_digital: { peso: 5, casos: { ativo: 5, vencido: 2, nunca: 0 } },
  },
}

const PARAMS: ParametrosScore = {
  corte_concessao: 40,
  completude_minima: 0.5,
  recencia_protesto_dias: 90,
  knockout_negada_meses: 6,
}

const AGORA = new Date('2026-07-31T12:00:00Z')

/** Empresa com TUDO conhecido e tudo bom: a referência contra a qual o resto é lido. */
const COMPLETA = {
  protesto_consultado: true,
  protesto_valor_total: 0,
  faturamento_estimado: 60_000_000,
  capital_social: 8_000_000,
  data_inicio_atividade: '2000-01-01',
  situacao_cadastral: 'ativa',
  teve_irregularidade: false,
  grupo_conhecido: true,
  grupo_spes_24m: 4,
  obras_ativas: 3,
  m2_em_execucao: 20_000,
  funcionarios_crescimento_12m: 0.3,
  certificado: 'ativo' as const,
}

// ─── pontosDaFaixa ──────────────────────────────────────────────────────────

test('a faixa é por limite superior INCLUSIVE', () => {
  const faixas = [
    { ate: 10, pontos: 1 },
    { ate: 20, pontos: 2 },
    { ate: null, pontos: 3 },
  ]
  assert.equal(pontosDaFaixa(10, faixas), 1) // o limite pertence à própria faixa
  assert.equal(pontosDaFaixa(10.01, faixas), 2)
  assert.equal(pontosDaFaixa(999, faixas), 3)
})

// ─── Renormalização ─────────────────────────────────────────────────────────

/**
 * 95, e não 100, porque "nunca analisada" vale 5 de 10 DE PROPÓSITO: nunca ter sido
 * analisada não é uma boa notícia nem uma má, e o teto perfeito tem de estar reservado
 * para quem já foi aprovado. Se este número virar 100 um dia, o fator neutro sumiu.
 */
test('tudo conhecido e tudo bom dá 95 (o histórico neutro segura os outros 5)', () => {
  const r = calcularScore(COMPLETA, DEF, PARAMS, AGORA)
  assert.equal(r.completude, 1)
  assert.equal(r.score, 95)
  assert.equal(r.faixa, 'alta')
})

/**
 * O teste central deste arquivo. Fator sem dado sai do numerador E do denominador: uma
 * empresa que nunca teve protesto consultado não pode ser lida como uma que foi
 * consultada e tem protesto.
 */
test('fator não avaliável sai da conta inteira — não vira zero', () => {
  const semProtesto = calcularScore(
    { ...COMPLETA, protesto_consultado: false },
    DEF,
    PARAMS,
    AGORA,
  )
  assert.equal(semProtesto.completude, 0.75, '25 dos 100 pesos saíram')

  // Renormalizado: 70 pontos obtidos sobre os 75 pesos que restaram = 93,33.
  assert.ok(Math.abs((semProtesto.score as number) - 93.33) < 0.01)

  // Se a ausência virasse zero, o denominador continuaria 100 e o score cairia para 70 —
  // a empresa pareceria PIOR que uma idêntica que foi consultada e está limpa (95).
  // A diferença entre 93,33 e 70 é toda a razão de este arquivo existir.
  assert.notEqual(semProtesto.score, 70)
})

test('completude abaixo do mínimo NÃO exibe score', () => {
  const r = calcularScore(
    {
      // Só idade, regularidade e histórico são avaliáveis: 30 de 100.
      data_inicio_atividade: '1990-01-01',
      situacao_cadastral: 'ativa',
    },
    DEF,
    PARAMS,
    AGORA,
  )
  assert.equal(r.score, null)
  assert.equal(r.faixa, 'dados_insuficientes')
  assert.ok(r.completude < 0.5)
})

test('o breakdown carrega TODOS os fatores, inclusive os não avaliáveis', () => {
  const r = calcularScore({ ...COMPLETA, protesto_consultado: false }, DEF, PARAMS, AGORA)
  assert.equal(r.breakdown.length, 9)
  const p = r.breakdown.find((b) => b.fator === 'protestos')
  assert.equal(p?.pontos, null)
  assert.equal(p?.observado, 'Protesto nunca consultado')
})

// ─── Protestos: relativização e recência ────────────────────────────────────

test('protesto é relativizado pelo faturamento, não lido em valor absoluto', () => {
  // R$ 100 mil: 0,17% de 60M (faixa boa) e 10% de 1M (faixa péssima).
  const grande = calcularScore(
    { ...COMPLETA, protesto_valor_total: 100_000, protesto_mais_recente_em: '2020-01-01' },
    DEF,
    PARAMS,
    AGORA,
  )
  const pequena = calcularScore(
    {
      ...COMPLETA,
      faturamento_estimado: 1_000_000,
      protesto_valor_total: 100_000,
      protesto_mais_recente_em: '2020-01-01',
    },
    DEF,
    PARAMS,
    AGORA,
  )
  const pg = grande.breakdown.find((b) => b.fator === 'protestos')?.pontos
  const pp = pequena.breakdown.find((b) => b.fator === 'protestos')?.pontos
  assert.equal(pg, 15)
  assert.equal(pp, 0)
})

test('protesto recente vale metade dos pontos', () => {
  const velho = calcularScore(
    { ...COMPLETA, protesto_valor_total: 100_000, protesto_mais_recente_em: '2020-01-01' },
    DEF,
    PARAMS,
    AGORA,
  )
  const recente = calcularScore(
    { ...COMPLETA, protesto_valor_total: 100_000, protesto_mais_recente_em: '2026-07-15' },
    DEF,
    PARAMS,
    AGORA,
  )
  assert.equal(velho.breakdown.find((b) => b.fator === 'protestos')?.pontos, 15)
  assert.equal(recente.breakdown.find((b) => b.fator === 'protestos')?.pontos, 7.5)
})

test('sem faturamento, o protesto é relativizado pelo capital — e o breakdown avisa', () => {
  const r = calcularScore(
    {
      ...COMPLETA,
      faturamento_estimado: null,
      capital_social: 10_000_000,
      protesto_valor_total: 30_000,
      protesto_mais_recente_em: '2020-01-01',
    },
    DEF,
    PARAMS,
    AGORA,
  )
  const p = r.breakdown.find((b) => b.fator === 'protestos')
  assert.equal(p?.pontos, 15) // 0,3% do capital
  assert.match(p?.ressalva ?? '', /capital social/)
})

test('sem faturamento e sem capital, cai em faixa absoluta e marca a ressalva', () => {
  const r = calcularScore(
    {
      ...COMPLETA,
      faturamento_estimado: null,
      capital_social: null,
      protesto_valor_total: 500_000,
      protesto_mais_recente_em: '2020-01-01',
    },
    DEF,
    PARAMS,
    AGORA,
  )
  const p = r.breakdown.find((b) => b.fator === 'protestos')
  assert.equal(p?.pontos, 0)
  assert.match(p?.ressalva ?? '', /faixa absoluta/)
})

// ─── Knockouts ──────────────────────────────────────────────────────────────

test('situação cadastral irregular zera o score, independentemente do resto', () => {
  const r = calcularScore({ ...COMPLETA, situacao_cadastral: 'baixada' }, DEF, PARAMS, AGORA)
  assert.equal(r.score, 0)
  assert.equal(r.faixa, 'improvavel')
  assert.equal(r.knockout, 'situacao_irregular')
})

/**
 * O knockout vem ANTES do corte de completude: uma empresa baixada na Receita é
 * improvável mesmo que não se saiba mais nada dela. "Não sei o resto" não apaga o que
 * se sabe.
 */
test('irregular com completude baixa continua improvável, não "dados insuficientes"', () => {
  const r = calcularScore({ situacao_cadastral: 'baixada' }, DEF, PARAMS, AGORA)
  assert.equal(r.faixa, 'improvavel')
  assert.equal(r.knockout, 'situacao_irregular')
})

test('negada recente TRAVA abaixo do corte, e não zera', () => {
  const r = calcularScore({ ...COMPLETA, analise_negada_em: '2026-06-01' }, DEF, PARAMS, AGORA)
  assert.equal(r.knockout, 'negada_recente')
  assert.equal(r.score, PARAMS.corte_concessao - 10)
  assert.equal(r.faixa, 'improvavel')
})

test('negada fora da janela deixa de travar', () => {
  const r = calcularScore({ ...COMPLETA, analise_negada_em: '2024-01-01' }, DEF, PARAMS, AGORA)
  assert.equal(r.knockout, null)
  assert.equal(r.score, 95)
})

// ─── Atividade do grupo ─────────────────────────────────────────────────────

test('grupo e obras desconhecidos: fator não avaliável (zero obras ≠ nenhuma obra conhecida)', () => {
  const r = calcularScore(
    { ...COMPLETA, grupo_conhecido: false, grupo_spes_24m: null, obras_ativas: null, m2_em_execucao: null },
    DEF,
    PARAMS,
    AGORA,
  )
  assert.equal(r.breakdown.find((b) => b.fator === 'atividade_grupo')?.pontos, null)
})

test('grupo conhecido e zerado pontua pouco, mas pontua', () => {
  const r = calcularScore(
    { ...COMPLETA, grupo_conhecido: true, grupo_spes_24m: 0, obras_ativas: 0, m2_em_execucao: 0 },
    DEF,
    PARAMS,
    AGORA,
  )
  assert.equal(r.breakdown.find((b) => b.fator === 'atividade_grupo')?.pontos, 3)
})

// ─── Histórico de análises ──────────────────────────────────────────────────

test('aprovada vigente vale mais que aprovada expirada', () => {
  const vigente = calcularScore(
    { ...COMPLETA, analise_estagio: 'aprovada', analise_vigente: true },
    DEF,
    PARAMS,
    AGORA,
  )
  const expirada = calcularScore(
    { ...COMPLETA, analise_estagio: 'aprovada', analise_vigente: false },
    DEF,
    PARAMS,
    AGORA,
  )
  assert.equal(vigente.breakdown.find((b) => b.fator === 'historico_analises')?.pontos, 10)
  assert.equal(expirada.breakdown.find((b) => b.fator === 'historico_analises')?.pontos, 7)
})

test('nunca analisada é NEUTRO (5), não penalidade', () => {
  const r = calcularScore(COMPLETA, DEF, PARAMS, AGORA)
  assert.equal(r.breakdown.find((b) => b.fator === 'historico_analises')?.pontos, 5)
})

/** Uma análise em andamento não é histórico: ela ainda não disse nada. */
test('análise em curso não pontua como decisão', () => {
  const r = calcularScore({ ...COMPLETA, analise_estagio: 'em_analise' }, DEF, PARAMS, AGORA)
  assert.equal(r.breakdown.find((b) => b.fator === 'historico_analises')?.pontos, 5)
})

// ─── Faixas ─────────────────────────────────────────────────────────────────

test('tudo conhecido e tudo mediano cai em `media`, com completude cheia', () => {
  // 5 (protesto a 2% do faturamento) + 8 + 8 + 7 + 10 + 5 + 3 + 3 + 2 = 51.
  const r = calcularScore(
    {
      ...COMPLETA,
      protesto_valor_total: 100_000, // 2% de 5M → última faixa boa
      protesto_mais_recente_em: '2020-01-01',
      faturamento_estimado: 5_000_000,
      capital_social: 2_000_000,
      data_inicio_atividade: '2019-01-01',
      funcionarios_crescimento_12m: 0,
      certificado: 'vencido',
      grupo_spes_24m: 1,
      obras_ativas: 1,
      m2_em_execucao: 0,
    },
    DEF,
    PARAMS,
    AGORA,
  )
  assert.equal(r.completude, 1)
  assert.equal(r.score, 51)
  assert.equal(r.faixa, 'media')
})

// ─── chanceDaFaixa ──────────────────────────────────────────────────────────

test('sem score, a chance é o default e vem MARCADA como presumida', () => {
  const r = chanceDaFaixa('dados_insuficientes', { alta: 0.8, media: 0.5, improvavel: 0.1 }, 0.5)
  assert.deepEqual(r, { chance: 0.5, presumida: true })
})

test('com faixa conhecida, a chance não é presumida', () => {
  assert.deepEqual(chanceDaFaixa('alta', { alta: 0.8, media: 0.5, improvavel: 0.1 }, 0.5), {
    chance: 0.8,
    presumida: false,
  })
})

// ─── Knockout de processo nosso (08 §9) ─────────────────────────────────────

test('processo nosso em curso zera a chance e vence os demais fatores', () => {
  const r = calcularScore(
    {
      protesto_consultado: true,
      protesto_valor_total: 0,
      faturamento_estimado: 80_000_000,
      situacao_cadastral: 'ativa',
      capital_social: 10_000_000,
      data_inicio_atividade: '2005-01-01',
      grupo_conhecido: true,
      grupo_spes_24m: 4,
      obras_ativas: 5,
      funcionarios_crescimento_12m: 0.3,
      certificado: 'ativo',
      tem_processo_nosso_ativo: true,
    },
    DEF,
    PARAMS,
  )
  assert.equal(r.knockout, 'processo_nosso_ativo')
  assert.equal(r.faixa, 'improvavel')
  assert.equal(r.score, 0)
})

test('processo nosso vence a situação cadastral irregular — é o fato que a casa produziu', () => {
  const r = calcularScore(
    { situacao_cadastral: 'baixada', tem_processo_nosso_ativo: true },
    DEF,
    PARAMS,
  )
  assert.equal(r.knockout, 'processo_nosso_ativo')
})

test('sem registro de processo NÃO é knockout — false e ausente são o mesmo "não sei"', () => {
  const semRegistro = calcularScore({ situacao_cadastral: 'ativa' }, DEF, PARAMS)
  const explicitoFalso = calcularScore(
    { situacao_cadastral: 'ativa', tem_processo_nosso_ativo: false },
    DEF,
    PARAMS,
  )
  assert.equal(semRegistro.knockout, null)
  assert.equal(explicitoFalso.knockout, null)
})
