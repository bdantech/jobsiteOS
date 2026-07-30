import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aplicarModelos,
  calibrarEstimador,
  crescimento12m,
  estimarFaturamento,
  mediaGeometricaPonderada,
  mediana,
  origemVence,
  variouOSuficiente,
  type Coeficientes,
} from './faturamento.ts'

/**
 * O que estes testes protegem não é a aritmética — é a REGRA DE NÃO AFIRMAR DEMAIS.
 * Uma estimativa que se apresenta com confiança 'alta' quando os modelos discordam,
 * ou que sobrescreve o faturamento que o cliente declarou, é pior que não ter
 * estimativa nenhuma: some a informação boa e fica a ruim, com a mesma aparência.
 */

const COEF: Coeficientes = {
  global: {
    ratio_fat_por_funcionario: 500_000,
    pct_mrr_sobre_faturamento: 0.01,
    fat_por_usuario_erp: 1_000_000,
    pesos: { funcionarios: 1, mrr: 1, usuarios_erp: 1 },
    n: 10,
  },
  porTipo: {},
}

const PARAMS = { teto_simples: 4_800_000, teto_presumido: 78_000_000, pct_teto_simples_default: 0.5 }

// ─── Hierarquia de origem ───────────────────────────────────────────────────

test('estimativa NUNCA sobrescreve o que o cliente declarou', () => {
  assert.equal(origemVence('modelo', 'declarado_cliente'), false)
  assert.equal(origemVence('bracket_simples', 'declarado_cliente'), false)
  assert.equal(origemVence('apollo', 'declarado_cliente'), false)
})

test('origem melhor vence, e mesma origem mais recente também', () => {
  assert.equal(origemVence('declarado_cliente', 'modelo'), true)
  assert.equal(origemVence('apollo', 'apollo_search'), true)
  assert.equal(origemVence('modelo', 'modelo'), true)
  assert.equal(origemVence('bracket_simples', 'modelo'), false)
})

test('sem valor vigente, qualquer origem entra', () => {
  assert.equal(origemVence('bracket_simples', null), true)
  assert.equal(origemVence('modelo', undefined), true)
})

// ─── Combinação ─────────────────────────────────────────────────────────────

test('média geométrica, não aritmética — o outlier não infla o resultado', () => {
  // 2M e 200M: a aritmética daria 101M, um número que não descreve nenhuma das duas.
  const g = mediaGeometricaPonderada([
    { valor: 2_000_000, peso: 1 },
    { valor: 200_000_000, peso: 1 },
  ])
  assert.equal(Math.round(g!), 20_000_000)
})

test('o peso pende para o modelo que erra menos', () => {
  const g = mediaGeometricaPonderada([
    { valor: 10_000_000, peso: 9 },
    { valor: 1_000_000, peso: 1 },
  ])
  // Muito mais perto de 10M que de 1M, mas não exatamente 10M.
  assert.ok(g! > 7_000_000 && g! < 10_000_000)
})

test('valor não positivo e peso zero são ignorados, não quebram', () => {
  assert.equal(mediaGeometricaPonderada([]), null)
  assert.equal(mediaGeometricaPonderada([{ valor: 0, peso: 1 }]), null)
  assert.equal(mediaGeometricaPonderada([{ valor: -5, peso: 1 }]), null)
  assert.equal(mediaGeometricaPonderada([{ valor: 100, peso: 0 }]), null)
})

// ─── Modelos disponíveis ────────────────────────────────────────────────────

test('só entram os modelos cujo sinal existe', () => {
  const m = aplicarModelos({ funcionarios: 10 }, COEF)
  assert.deepEqual(m.map((x) => x.id), ['funcionarios'])
  assert.equal(m[0]!.valor, 5_000_000)
})

test('sem sinal nenhum, nenhum modelo', () => {
  assert.deepEqual(aplicarModelos({}, COEF), [])
  assert.deepEqual(aplicarModelos({ funcionarios: 0, erp_mrr: 0, qtd_usuarios_erp: 0 }, COEF), [])
})

test('coeficiente do tipo vence o global quando existe', () => {
  const coef: Coeficientes = {
    ...COEF,
    porTipo: {
      incorporadora: {
        ratio_fat_por_funcionario: 2_000_000,
        pct_mrr_sobre_faturamento: null,
        fat_por_usuario_erp: null,
        pesos: { funcionarios: 1, mrr: 1, usuarios_erp: 1 },
        n: 8,
      },
    },
  }
  assert.equal(aplicarModelos({ tipo: 'incorporadora', funcionarios: 10 }, coef)[0]!.valor, 20_000_000)
  // Tipo sem calibração própria cai no global — não fica sem estimativa.
  assert.equal(aplicarModelos({ tipo: 'subempreiteiro', funcionarios: 10 }, coef)[0]!.valor, 5_000_000)
})

// ─── Confiança ──────────────────────────────────────────────────────────────

test('duas FAMÍLIAS concordando dentro de 2× é confiança alta', () => {
  // Equipe (10M) × ERP (8M) — medições independentes, razão 1,25.
  const r = estimarFaturamento({ funcionarios: 20, qtd_usuarios_erp: 8 }, COEF, PARAMS)
  assert.equal(r.modelos.length, 2)
  assert.deepEqual([...r.familias].sort(), ['erp', 'headcount'])
  assert.equal(r.confianca, 'alta')
})

test('um modelo só é média, nunca alta', () => {
  const r = estimarFaturamento({ funcionarios: 20 }, COEF, PARAMS)
  assert.equal(r.confianca, 'media')
  assert.equal(r.origem, 'modelo')
})

test('famílias divergentes derrubam a confiança para média', () => {
  // 20 funcionários → 10M; 1 usuário de ERP → 1M. Razão 10×.
  const r = estimarFaturamento({ funcionarios: 20, qtd_usuarios_erp: 1 }, COEF, PARAMS)
  assert.equal(r.modelos.length, 2)
  assert.equal(r.familias.length, 2)
  assert.equal(r.confianca, 'media')
})

// ─── Famílias de sinal ──────────────────────────────────────────────────────

test('MRR e usuários de ERP são a MESMA família — concordar entre si não promove', () => {
  // Este é o caso das ~5.000 empresas da base: os dois sinais saem do mesmo
  // `erp_detalhes` e concordam mecanicamente (MRR por usuário tem mediana de R$ 477).
  // Contar isso como duas evidências daria selo de confiança alta a uma medição só.
  const r = estimarFaturamento({ erp_mrr: 10_000, qtd_usuarios_erp: 12 }, COEF, PARAMS)
  assert.equal(r.modelos.length, 2, 'os dois modelos entram no cálculo')
  assert.deepEqual(r.familias, ['erp'], 'mas são uma família só')
  assert.equal(r.confianca, 'media')
})

test('a família redundante não leva peso dobrado na combinação', () => {
  // ERP rende dois modelos, equipe rende um. Se o peso fosse somado, o ERP dominaria
  // por CONTAGEM e não por qualidade. Com dois modelos de ERP idênticos em valor, o
  // resultado tem de ser igual ao de um único modelo de ERP com aquele valor.
  const doisDeErp = estimarFaturamento({ funcionarios: 20, erp_mrr: 10_000, qtd_usuarios_erp: 12 }, COEF, PARAMS)
  const umDeErp = estimarFaturamento({ funcionarios: 20, qtd_usuarios_erp: 12 }, COEF, PARAMS)
  // mrr: 10k×12/0,01 = 12M; usuarios: 12×1M = 12M. A família de ERP vale 12M nos dois
  // casos, e a de equipe vale 10M — logo o valor combinado tem de ser o mesmo.
  assert.equal(doisDeErp.valor, umDeErp.valor)
})

test('uma família só, com um modelo só, continua sendo média', () => {
  const r = estimarFaturamento({ erp_mrr: 10_000 }, COEF, PARAMS)
  assert.deepEqual(r.familias, ['erp'])
  assert.equal(r.confianca, 'media')
})

// ─── Restrições ─────────────────────────────────────────────────────────────

test('optante do Simples tem cap no teto', () => {
  const r = estimarFaturamento({ funcionarios: 100, opcao_simples: true }, COEF, PARAMS)
  assert.equal(r.valor, PARAMS.teto_simples) // 50M viraria impossível para optante
  assert.deepEqual(r.restricoes, ['cap_simples'])
  assert.equal(r.origem, 'modelo')
})

test('optante abaixo do teto não é tocado', () => {
  const r = estimarFaturamento({ funcionarios: 4, opcao_simples: true }, COEF, PARAMS)
  assert.equal(r.valor, 2_000_000)
  assert.deepEqual(r.restricoes, [])
})

test('optante SEM modelo nenhum vira faixa do Simples, e não null', () => {
  const r = estimarFaturamento({ opcao_simples: true }, COEF, PARAMS)
  assert.equal(r.valor, 2_400_000)
  assert.equal(r.origem, 'bracket_simples')
  assert.equal(r.confianca, 'baixa')
  assert.deepEqual(r.modelos, [])
})

test('quem saiu do Simples tem o teto como PISO, não como teto', () => {
  // 2 funcionários → 1M, abaixo do teto. Mas quem saiu do Simples estourou o teto.
  const r = estimarFaturamento(
    { funcionarios: 2, opcao_simples: false, data_exclusao_simples: '2024-01-01' },
    COEF,
    PARAMS,
  )
  assert.equal(r.valor, PARAMS.teto_simples)
  assert.deepEqual(r.restricoes, ['piso_saiu_simples'])
})

test('quem saiu do Simples e já estima acima do teto não é rebaixado', () => {
  const r = estimarFaturamento(
    { funcionarios: 40, opcao_simples: false, data_exclusao_simples: '2024-01-01' },
    COEF,
    PARAMS,
  )
  assert.equal(r.valor, 20_000_000)
  assert.deepEqual(r.restricoes, [])
})

test('saiu do Simples sem modelo nenhum fica no teto, com confiança baixa', () => {
  const r = estimarFaturamento({ data_exclusao_simples: '2024-01-01' }, COEF, PARAMS)
  assert.equal(r.valor, PARAMS.teto_simples)
  assert.equal(r.origem, 'bracket_simples')
  assert.equal(r.confianca, 'baixa')
})

test('presumido limita, e não inventa valor', () => {
  const r = estimarFaturamento({ funcionarios: 400, regime_tributario: 'presumido' }, COEF, PARAMS)
  assert.equal(r.valor, PARAMS.teto_presumido) // 200M capado
  assert.deepEqual(r.restricoes, ['cap_presumido'])

  // Abaixo do teto, o regime não muda nada — não puxa o valor para cima.
  const abaixo = estimarFaturamento({ funcionarios: 10, regime_tributario: 'presumido' }, COEF, PARAMS)
  assert.equal(abaixo.valor, 5_000_000)
  assert.deepEqual(abaixo.restricoes, [])
})

test('a restrição é aplicada DEPOIS da combinação — o cap não fabrica concordância', () => {
  // Dois modelos absurdamente divergentes, ambos acima do teto do Simples. Se o cap
  // rodasse antes, os dois virariam 4,8M, "concordariam" e a confiança sairia alta.
  const r = estimarFaturamento({ funcionarios: 100, qtd_usuarios_erp: 500, opcao_simples: true }, COEF, PARAMS)
  assert.equal(r.valor, PARAMS.teto_simples)
  assert.equal(r.confianca, 'media')
})

test('sem sinal e sem Simples, a resposta é null — não é zero', () => {
  const r = estimarFaturamento({}, COEF, PARAMS)
  assert.equal(r.valor, null)
  assert.equal(r.origem, null)
  assert.equal(r.confianca, null)
})

// ─── Calibração ─────────────────────────────────────────────────────────────

test('mediana, não média: um cliente gigante não desloca o coeficiente', () => {
  assert.equal(mediana([1, 2, 3]), 2)
  assert.equal(mediana([1, 2, 3, 4]), 2.5)
  assert.equal(mediana([]), null)
  assert.equal(mediana([1, 2, 3, 1_000_000]), 2.5)
})

test('calibra o ratio pela mediana dos clientes declarados', () => {
  const r = calibrarEstimador(
    [
      { faturamento_declarado: 10_000_000, funcionarios: 20 }, // 500k
      { faturamento_declarado: 6_000_000, funcionarios: 10 }, // 600k
      { faturamento_declarado: 8_000_000, funcionarios: 20 }, // 400k
    ],
    { nMinimoPorTipo: 5 },
  )
  assert.equal(r.coeficientes.global.ratio_fat_por_funcionario, 500_000)
})

test('tipo abaixo do n mínimo NÃO ganha coeficientes próprios', () => {
  const r = calibrarEstimador(
    [
      { tipo: 'incorporadora', faturamento_declarado: 10_000_000, funcionarios: 5 },
      { tipo: 'incorporadora', faturamento_declarado: 20_000_000, funcionarios: 10 },
      { tipo: 'construtora', faturamento_declarado: 5_000_000, funcionarios: 10 },
    ],
    { nMinimoPorTipo: 5 },
  )
  assert.deepEqual(Object.keys(r.coeficientes.porTipo), [])
  // Mas o n é reportado, para a página do Estimador mostrar o que falta.
  assert.equal(r.nPorTipo.incorporadora, 2)
  assert.equal(r.nPorTipo.construtora, 1)
})

test('tipo com amostras suficientes ganha coeficientes próprios', () => {
  const amostras = Array.from({ length: 5 }, (_, i) => ({
    tipo: 'construtora',
    faturamento_declarado: 1_000_000 * (i + 1),
    funcionarios: i + 1,
  }))
  const r = calibrarEstimador(amostras, { nMinimoPorTipo: 5 })
  assert.equal(r.coeficientes.porTipo.construtora?.ratio_fat_por_funcionario, 1_000_000)
  assert.equal(r.coeficientes.porTipo.construtora?.n, 5)
})

test('o modelo que erra mais pesa menos — o sistema descobre qual sinal serve', () => {
  // `funcionarios` prevê perfeitamente; `usuarios_erp` erra feio em uma das amostras.
  const r = calibrarEstimador(
    [
      { faturamento_declarado: 10_000_000, funcionarios: 10, qtd_usuarios_erp: 10 },
      { faturamento_declarado: 20_000_000, funcionarios: 20, qtd_usuarios_erp: 1 },
      { faturamento_declarado: 30_000_000, funcionarios: 30, qtd_usuarios_erp: 100 },
    ],
    { nMinimoPorTipo: 5 },
  )
  const p = r.coeficientes.global.pesos
  assert.ok(p.funcionarios > p.usuarios_erp, 'funcionários deveria pesar mais que usuários')
})

test('modelo sem amostra entra com peso neutro, não com zero', () => {
  // Zerar mataria o único modelo disponível de uma empresa, e a estimativa sumiria.
  const r = calibrarEstimador([{ faturamento_declarado: 1_000_000, funcionarios: 2 }], { nMinimoPorTipo: 5 })
  assert.equal(r.coeficientes.global.pesos.mrr, 1)
  assert.equal(r.coeficientes.global.pct_mrr_sobre_faturamento, null)
})

test('calibração vazia não quebra e não inventa coeficiente', () => {
  const r = calibrarEstimador([], { nMinimoPorTipo: 5 })
  assert.equal(r.coeficientes.global.ratio_fat_por_funcionario, null)
  assert.equal(r.coeficientes.global.n, 0)
  assert.deepEqual(aplicarModelos({ funcionarios: 50 }, r.coeficientes), [])
})

// ─── Série ──────────────────────────────────────────────────────────────────

test('crescimento em 12 meses, contra o ponto mais próximo de um ano atrás', () => {
  const s = [
    { valor: 120, capturado_em: '2026-07-01T00:00:00Z' },
    { valor: 100, capturado_em: '2025-07-05T00:00:00Z' },
    { valor: 60, capturado_em: '2024-01-01T00:00:00Z' },
  ]
  assert.equal(crescimento12m(s), 0.2)
})

test('menos de dois pontos é null — e null NÃO é zero', () => {
  assert.equal(crescimento12m([]), null)
  assert.equal(crescimento12m([{ valor: 10, capturado_em: '2026-07-01T00:00:00Z' }]), null)
})

test('queda de headcount aparece como negativa', () => {
  const s = [
    { valor: 80, capturado_em: '2026-07-01T00:00:00Z' },
    { valor: 100, capturado_em: '2025-07-01T00:00:00Z' },
  ]
  assert.equal(crescimento12m(s), -0.2)
})

test('snapshot de modelo só é gravado quando a variação passa do mínimo', () => {
  assert.equal(variouOSuficiente(110, 100, 0.1), false) // exatamente 10% não passa
  assert.equal(variouOSuficiente(111, 100, 0.1), true)
  assert.equal(variouOSuficiente(89, 100, 0.1), true)
  // Sem anterior, sempre grava: é o primeiro ponto da série.
  assert.equal(variouOSuficiente(100, null, 0.1), true)
})
