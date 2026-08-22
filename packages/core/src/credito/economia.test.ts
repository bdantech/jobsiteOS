import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  calcularPotencial,
  calibrarCredito,
  coeficientesVazios,
  medianaPositiva,
  type CoeficientesCredito,
  type ParametrosEconomia,
  type ParametrosLimite,
} from './economia.ts'

const ECONOMIA: ParametrosEconomia = {
  taxa_padrao_am: 1.9,
  tac: 150,
  valor_medio_nf: 25_000,
  prazo_medio_dias: 45,
  utilizacao_media: null,
  giro_mensal: null,
}

const LIMITE: ParametrosLimite = {
  ratio_limite_manual: null,
  cap_absoluto: 5_000_000,
  cap_pct_faturamento: 0.15,
}

const COEF: CoeficientesCredito = {
  ratio_limite: { global: 0.1, porTipo: {} },
  giro_mensal: 0.15,
  utilizacao_media: null,
  n_clientes: 40,
  n_declarantes: 12,
}

const CHANCE = { valor: 0.8, presumida: false }

// ─── Calibração ─────────────────────────────────────────────────────────────

test('medianaPositiva ignora zero e não-finito, e resolve o par pelo meio', () => {
  assert.equal(medianaPositiva([3, 1, 2]), 2)
  assert.equal(medianaPositiva([1, 2, 3, 4]), 2.5)
  assert.equal(medianaPositiva([0, -1, Number.NaN]), null)
  assert.equal(medianaPositiva([]), null)
})

test('ratio de limite sai da medianaPositiva de limite ÷ faturamento declarado', () => {
  const c = calibrarCredito([
    { credit_limit: 1_000_000, faturamento_declarado: 10_000_000 }, // 0,10
    { credit_limit: 600_000, faturamento_declarado: 10_000_000 }, // 0,06
    { credit_limit: 2_000_000, faturamento_declarado: 10_000_000 }, // 0,20
  ])
  assert.equal(c.ratio_limite.global, 0.1)
  assert.equal(c.n_declarantes, 3)
})

/**
 * O giro sai de limite e volume — os dois medidos na carteira, nenhum dependendo de
 * faturamento declarado. É o elo da cadeia que funciona antes de qualquer declaração.
 */
test('giro mensal calibra sem NENHUM faturamento declarado', () => {
  const c = calibrarCredito([
    { credit_limit: 1_000_000, gross_value_last_2m: 300_000 }, // 0,15
    { credit_limit: 2_000_000, gross_value_last_2m: 800_000 }, // 0,20
    { credit_limit: 500_000, gross_value_last_2m: 100_000 }, // 0,10
  ])
  assert.equal(c.giro_mensal, 0.15)
  assert.equal(c.ratio_limite.global, null, 'sem declarante não há ratio, e null é a resposta')
  assert.equal(c.n_declarantes, 0)
})

test('tipo abaixo do n mínimo NÃO ganha coeficiente próprio', () => {
  const amostras = [
    { tipo: 'incorporadora', credit_limit: 2_000_000, faturamento_declarado: 10_000_000 },
    { tipo: 'incorporadora', credit_limit: 2_000_000, faturamento_declarado: 10_000_000 },
    ...Array.from({ length: 5 }, () => ({
      tipo: 'construtora',
      credit_limit: 1_000_000,
      faturamento_declarado: 10_000_000,
    })),
  ]
  const c = calibrarCredito(amostras, 5)
  assert.equal(c.ratio_limite.porTipo.construtora, 0.1)
  assert.equal(
    c.ratio_limite.porTipo.incorporadora,
    undefined,
    'duas empresas não são um ratio, são o acaso das duas',
  )
})

// ─── Sem calibração não se estima ───────────────────────────────────────────

test('sem faturamento estimado não há limite — e o motivo é declarado', () => {
  const r = calcularPotencial({ faturamento_estimado: null }, COEF, ECONOMIA, LIMITE, CHANCE)
  assert.equal(r.limite_potencial, null)
  assert.equal(r.valor_esperado_mensal, null)
  assert.equal(r.motivo, 'sem_faturamento')
})

/**
 * Zero seria pior que null: zero ordena a base como "não vale nada", quando o que se
 * sabe é que não se sabe. A régua de ordenação do Explorador depende dessa diferença.
 */
test('sem ratio calibrado devolve null, NUNCA zero', () => {
  const r = calcularPotencial(
    { faturamento_estimado: 10_000_000 },
    coeficientesVazios(),
    ECONOMIA,
    LIMITE,
    CHANCE,
  )
  assert.equal(r.limite_potencial, null)
  assert.notEqual(r.limite_potencial, 0)
  assert.equal(r.motivo, 'sem_calibracao')
})

test('sem giro (nem calibrado nem manual) também não fecha a conta', () => {
  const r = calcularPotencial(
    { faturamento_estimado: 10_000_000 },
    { ...COEF, giro_mensal: null },
    ECONOMIA,
    LIMITE,
    CHANCE,
  )
  assert.equal(r.motivo, 'sem_calibracao')
})

// ─── A cadeia ───────────────────────────────────────────────────────────────

test('a cadeia inteira, com número conferível', () => {
  const r = calcularPotencial(
    { faturamento_estimado: 10_000_000, faturamento_confianca: 'media' },
    COEF,
    ECONOMIA,
    LIMITE,
    CHANCE,
  )
  // limite = min(10M × 0,10 ; 5M ; 10M × 0,15) = 1.000.000
  assert.equal(r.limite_potencial, 1_000_000)
  assert.equal(r.cap_aplicado, 'ratio')
  // volume = 1M × (30/45 giros) × 0,225 de utilização = 150.000
  // (o giro calibrado 0,15 vira utilização 0,15 × 45/30 = 0,225 — a mesma coisa)
  assert.equal(r.volume_mensal, 150_000)
  // financeira = 150.000 × 1,9% × (45/30) = 4.275
  assert.equal(r.receita_financeira, 4_275)
  // tac = (150.000 / 25.000) × 150 = 900
  assert.equal(r.receita_tac, 900)
  assert.equal(r.receita_mensal_prevista, 5_175)
  // esperado = 5.175 × 0,8 = 4.140
  assert.equal(r.valor_esperado_mensal, 4_140)
  // sem taxa conhecida, a padrão — e a previsão diz que foi a padrão.
  assert.equal(r.taxa_am, 1.9)
  assert.equal(r.taxa_real, false)
})

// ─── A taxa da própria empresa ──────────────────────────────────────────────

test('a taxa real da empresa vence a padrão, e a conta muda junto', () => {
  const r = calcularPotencial(
    { faturamento_estimado: 10_000_000, taxa_mensal_am: 2.6 },
    COEF,
    ECONOMIA,
    LIMITE,
    CHANCE,
  )
  // financeira = 150.000 × 2,6% × (45/30) = 5.850, contra 4.275 na taxa padrão.
  // (2,6/100 não tem representação exata em binário; a conta não é arredondada.)
  assert.ok(Math.abs((r.receita_financeira ?? 0) - 5_850) < 0.01)
  assert.equal(r.taxa_am, 2.6)
  assert.equal(r.taxa_real, true)
  // A TAC não depende da taxa: continua saindo do volume.
  assert.equal(r.receita_tac, 900)
})

test('taxa zero, negativa ou não-finita cai na padrão em vez de zerar a receita', () => {
  // Um zero aqui é dado faltando disfarçado de dado — e zeraria a receita
  // financeira inteira em silêncio, que é o pior jeito de errar este número.
  for (const taxa of [0, -1, Number.NaN, null, undefined]) {
    const r = calcularPotencial(
      { faturamento_estimado: 10_000_000, taxa_mensal_am: taxa },
      COEF,
      ECONOMIA,
      LIMITE,
      CHANCE,
    )
    assert.equal(r.taxa_am, 1.9)
    assert.equal(r.taxa_real, false)
    assert.equal(r.receita_financeira, 4_275)
  }
})

test('o cap absoluto morde e diz que mordeu', () => {
  const r = calcularPotencial(
    { faturamento_estimado: 500_000_000 },
    { ...COEF, ratio_limite: { global: 0.1, porTipo: {} } },
    ECONOMIA,
    LIMITE,
    CHANCE,
  )
  assert.equal(r.limite_potencial, 5_000_000)
  assert.equal(r.cap_aplicado, 'absoluto')
})

test('o cap de % do faturamento morde quando o ratio é generoso', () => {
  const r = calcularPotencial(
    { faturamento_estimado: 10_000_000 },
    { ...COEF, ratio_limite: { global: 0.5, porTipo: {} } },
    ECONOMIA,
    LIMITE,
    CHANCE,
  )
  assert.equal(r.limite_potencial, 1_500_000) // 15% de 10M
  assert.equal(r.cap_aplicado, 'pct_faturamento')
})

test('o ratio por tipo vence o global', () => {
  const coef: CoeficientesCredito = {
    ...COEF,
    ratio_limite: { global: 0.05, porTipo: { incorporadora: 0.12 } },
  }
  const inc = calcularPotencial(
    { tipo: 'incorporadora', faturamento_estimado: 10_000_000 },
    coef,
    ECONOMIA,
    LIMITE,
    CHANCE,
  )
  const outra = calcularPotencial(
    { tipo: 'construtora', faturamento_estimado: 10_000_000 },
    coef,
    ECONOMIA,
    LIMITE,
    CHANCE,
  )
  assert.equal(inc.limite_potencial, 1_200_000)
  assert.equal(outra.limite_potencial, 500_000)
})

test('o override manual do ratio vence tudo', () => {
  const r = calcularPotencial(
    { tipo: 'incorporadora', faturamento_estimado: 10_000_000 },
    { ...COEF, ratio_limite: { global: 0.05, porTipo: { incorporadora: 0.12 } } },
    ECONOMIA,
    { ...LIMITE, ratio_limite_manual: 0.08 },
    CHANCE,
  )
  assert.equal(r.limite_potencial, 800_000)
})

// ─── Propagação de confiança ────────────────────────────────────────────────

/**
 * O teste que impede o pior defeito possível desta feature: uma multiplicação não cria
 * informação. Não existe caminho que devolva `alta` a partir de uma estimativa `media`.
 */
test('a confiança do limite HERDA a do faturamento, sem promoção', () => {
  for (const [entrada, esperada] of [
    ['alta', 'alta'],
    ['media', 'media'],
    ['baixa', 'baixa'],
    [null, 'baixa'],
    ['qualquer_coisa', 'baixa'],
  ] as const) {
    const r = calcularPotencial(
      { faturamento_estimado: 10_000_000, faturamento_confianca: entrada },
      COEF,
      ECONOMIA,
      LIMITE,
      CHANCE,
    )
    assert.equal(r.confianca, esperada, `${entrada} deveria herdar ${esperada}`)
  }
})

test('chance presumida atravessa a conta e chega marcada no resultado', () => {
  const r = calcularPotencial(
    { faturamento_estimado: 10_000_000 },
    COEF,
    ECONOMIA,
    LIMITE,
    { valor: 0.5, presumida: true },
  )
  assert.equal(r.chance_presumida, true)
  assert.equal(r.valor_esperado_mensal, (r.receita_mensal_prevista as number) * 0.5)
})

test('o giro manual da config vence o calibrado', () => {
  const r = calcularPotencial(
    { faturamento_estimado: 10_000_000 },
    COEF,
    { ...ECONOMIA, giro_mensal: 0.3 },
    LIMITE,
    CHANCE,
  )
  assert.equal(r.volume_mensal, 300_000)
})

/*
 * A troca de `giro` por `(30/prazo) × utilização` é uma REESCRITA, não uma mudança de
 * resultado: as duas formas medem o mesmo fato. Estes testes existem para provar isso —
 * uma reescrita que muda o número em silêncio é a pior espécie de refatoração.
 */
test('a utilização derivada do giro antigo reproduz o número antigo', () => {
  const r = calcularPotencial(
    { faturamento_estimado: 10_000_000, faturamento_confianca: 'media' },
    { ...COEF, giro_mensal: 0.15, utilizacao_media: null },
    { ...ECONOMIA, utilizacao_media: null },
    LIMITE,
    CHANCE,
  )
  assert.equal(r.volume_mensal, 150_000)
})

test('utilização explícita na config vence a derivada do giro', () => {
  const r = calcularPotencial(
    { faturamento_estimado: 10_000_000, faturamento_confianca: 'media' },
    { ...COEF, giro_mensal: 0.15 },
    { ...ECONOMIA, utilizacao_media: 1 },
    LIMITE,
    CHANCE,
  )
  // Uso de 100%: o limite gira 30/45 vezes e nada o freia.
  assert.ok(Math.abs((r.volume_mensal as number) - 1_000_000 * (30 / 45)) < 1e-6)
  // E aí a receita financeira é o limite inteiro rendendo a taxa do mês.
  assert.ok(Math.abs((r.receita_financeira as number) - 1_000_000 * 0.019) < 1e-6)
})

test('a utilização calibrada vence a derivação, e perde para o override manual', () => {
  const calibrada = calcularPotencial(
    { faturamento_estimado: 10_000_000, faturamento_confianca: 'media' },
    { ...COEF, giro_mensal: 0.15, utilizacao_media: 0.5 },
    { ...ECONOMIA, utilizacao_media: null },
    LIMITE,
    CHANCE,
  )
  assert.ok(Math.abs((calibrada.volume_mensal as number) - 1_000_000 * (30 / 45) * 0.5) < 1e-6)

  const manual = calcularPotencial(
    { faturamento_estimado: 10_000_000, faturamento_confianca: 'media' },
    { ...COEF, giro_mensal: 0.15, utilizacao_media: 0.5 },
    { ...ECONOMIA, utilizacao_media: 0.2 },
    LIMITE,
    CHANCE,
  )
  assert.ok(Math.abs((manual.volume_mensal as number) - 1_000_000 * (30 / 45) * 0.2) < 1e-6)
})

test('prazo zero não vira giro infinito — a conta se recusa', () => {
  const r = calcularPotencial(
    { faturamento_estimado: 10_000_000, faturamento_confianca: 'media' },
    { ...COEF, giro_mensal: 0.15, utilizacao_media: null },
    { ...ECONOMIA, prazo_medio_dias: 0, utilizacao_media: null },
    LIMITE,
    CHANCE,
  )
  assert.equal(r.limite_potencial, null)
  assert.equal(r.motivo, 'sem_calibracao')
})

test('sem utilização e sem giro, a conta não fecha', () => {
  const r = calcularPotencial(
    { faturamento_estimado: 10_000_000, faturamento_confianca: 'media' },
    { ...COEF, giro_mensal: null, utilizacao_media: null },
    { ...ECONOMIA, utilizacao_media: null },
    LIMITE,
    CHANCE,
  )
  assert.equal(r.motivo, 'sem_calibracao')
})
