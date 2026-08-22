import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PARAMETROS_PADRAO,
  achatarExtracao,
  avaliarKnockouts,
  cagrReceita,
  calcularAnalise,
  calcularIndicadores,
  calcularTetos,
  classificar,
  classificarQuadrante,
  criticosPendentes,
  derivarEbitda,
  menorTeto,
  motivoObrigatorio,
  protestoVencido,
  type ContextoAnalise,
  type DadosExtraidos,
  type ExercicioContabil,
  type ParametrosAnalise,
} from './analise.js'

const vazio: ExercicioContabil = {
  exercicio: 2024,
  receita_bruta: null,
  receita_liquida: null,
  cmv: null,
  lucro_bruto: null,
  despesas_operacionais: null,
  depreciacao_amortizacao: null,
  resultado_equivalencia_patrimonial: null,
  ebitda: null,
  resultado_financeiro: null,
  lucro_liquido: null,
  ativo_circulante: null,
  ativo_nao_circulante: null,
  caixa: null,
  contas_receber: null,
  estoques: null,
  passivo_circulante: null,
  passivo_nao_circulante: null,
  emprestimos_curto_prazo: null,
  emprestimos_longo_prazo: null,
  fornecedores: null,
  patrimonio_liquido: null,
}

/** Uma construtora saudável e completa: serve de linha de base para os testes. */
const saudavel: ExercicioContabil = {
  ...vazio,
  exercicio: 2024,
  receita_bruta: 100_000_000,
  receita_liquida: 90_000_000,
  cmv: 63_000_000,
  lucro_bruto: 27_000_000,
  ebitda: 13_500_000,
  resultado_financeiro: -3_000_000,
  lucro_liquido: 7_200_000,
  ativo_circulante: 60_000_000,
  ativo_nao_circulante: 40_000_000,
  caixa: 12_000_000,
  contas_receber: 20_000_000,
  estoques: 15_000_000,
  passivo_circulante: 30_000_000,
  passivo_nao_circulante: 20_000_000,
  emprestimos_curto_prazo: 10_000_000,
  emprestimos_longo_prazo: 15_000_000,
  fornecedores: 8_000_000,
  patrimonio_liquido: 50_000_000,
}

const contexto = (over: Partial<ContextoAnalise> = {}): ContextoAnalise => ({
  exercicios: [saudavel],
  opera_na_plataforma: false,
  media_mensal_nfe: null,
  limite_seguradora: null,
  faixa_score: 'alta',
  knockout_score: null,
  ...over,
})

const params = (over: Partial<ParametrosAnalise> = {}): ParametrosAnalise => ({
  ...PARAMETROS_PADRAO,
  ...over,
})

const ind = (r: ReturnType<typeof calcularIndicadores>, id: string) => r.find((i) => i.id === id)!
const teto = (r: ReturnType<typeof calcularTetos>, id: string) => r.find((t) => t.id === id)!

describe('indicadores', () => {
  it('calcula as onze fórmulas sobre um exercício completo', () => {
    const r = calcularIndicadores(contexto(), PARAMETROS_PADRAO)

    assert.equal(ind(r, 'liquidez_corrente').valor, 2)
    assert.equal(ind(r, 'liquidez_seca').valor, 1.5)
    assert.equal(ind(r, 'endividamento_geral').valor, 0.5)
    // (10M + 15M − 12M) / 13,5M
    assert.ok(Math.abs((ind(r, 'divida_liquida_ebitda').valor as number) - 13 / 13.5) < 1e-9)
    assert.equal(ind(r, 'margem_ebitda').valor, 0.15)
    assert.equal(ind(r, 'margem_liquida').valor, 0.08)
    assert.ok(Math.abs((ind(r, 'roe').valor as number) - 0.144) < 1e-9)
    assert.equal(ind(r, 'giro_ativo').valor, 0.9)
    assert.equal(ind(r, 'pmr').valor, 73)
    assert.equal(ind(r, 'cobertura_juros').valor, 4.5)
  })

  it('sem insumo, valor e faixa são null — e o motivo diz o que falta', () => {
    const r = calcularIndicadores(contexto({ exercicios: [vazio] }), PARAMETROS_PADRAO)
    for (const i of r) {
      assert.equal(i.valor, null, `${i.id} deveria ser null`)
      assert.equal(i.faixa, null, `${i.id} não pode ter semáforo sem valor`)
      assert.ok(i.motivo_sem_valor, `${i.id} precisa dizer o que falta`)
    }
  })

  it('soma parcial não vira total: ativo total exige as duas metades', () => {
    const meio = { ...saudavel, ativo_nao_circulante: null }
    const r = calcularIndicadores(contexto({ exercicios: [meio] }), PARAMETROS_PADRAO)
    assert.equal(ind(r, 'endividamento_geral').valor, null)
    assert.equal(ind(r, 'giro_ativo').valor, null)
    // Mas o que não depende do ativo total continua saindo.
    assert.equal(ind(r, 'liquidez_corrente').valor, 2)
  })

  it('divisão por zero devolve null, nunca Infinity', () => {
    const semPc = { ...saudavel, passivo_circulante: 0 }
    const r = calcularIndicadores(contexto({ exercicios: [semPc] }), PARAMETROS_PADRAO)
    assert.equal(ind(r, 'liquidez_corrente').valor, null)
  })

  it('resultado financeiro positivo não é cobertura infinita — é indicador inaplicável', () => {
    const semJuros = { ...saudavel, resultado_financeiro: 500_000 }
    const r = calcularIndicadores(contexto({ exercicios: [semJuros] }), PARAMETROS_PADRAO)
    const c = ind(r, 'cobertura_juros')
    assert.equal(c.valor, null)
    assert.match(c.motivo_sem_valor ?? '', /não há despesa de juros/)
  })

  it('o semáforo respeita a direção do indicador', () => {
    // maior_melhor
    assert.equal(classificar(1.4, PARAMETROS_PADRAO.indicadores.liquidez_corrente), 'verde')
    assert.equal(classificar(1.1, PARAMETROS_PADRAO.indicadores.liquidez_corrente), 'amarelo')
    assert.equal(classificar(0.9, PARAMETROS_PADRAO.indicadores.liquidez_corrente), 'vermelho')
    // menor_melhor
    assert.equal(classificar(0.5, PARAMETROS_PADRAO.indicadores.endividamento_geral), 'verde')
    assert.equal(classificar(0.7, PARAMETROS_PADRAO.indicadores.endividamento_geral), 'amarelo')
    assert.equal(classificar(0.9, PARAMETROS_PADRAO.indicadores.endividamento_geral), 'vermelho')
    assert.equal(classificar(null, PARAMETROS_PADRAO.indicadores.roe), null)
  })
})

describe('recência do protesto', () => {
  const agora = new Date('2026-08-22T12:00:00Z')
  const dias = (n: number) => new Date(agora.getTime() - n * 86_400_000).toISOString()

  it('nunca consultado exige consulta — e não é "sem protesto"', () => {
    assert.equal(protestoVencido(null, 90, agora), true)
    assert.equal(protestoVencido(undefined, 90, agora), true)
  })

  it('consulta recente é reaproveitada, e não repaga', () => {
    assert.equal(protestoVencido(dias(1), 90, agora), false)
    assert.equal(protestoVencido(dias(89), 90, agora), false)
  })

  it('na borda exata da janela, reconsulta', () => {
    assert.equal(protestoVencido(dias(90), 90, agora), true)
    assert.equal(protestoVencido(dias(400), 90, agora), true)
  })

  it('data corrompida não vira consulta válida por acidente', () => {
    assert.equal(protestoVencido('não é data', 90, agora), true)
  })

  it('janela zero força consulta sempre', () => {
    assert.equal(protestoVencido(dias(0), 0, agora), true)
  })
})

describe('EBITDA derivado', () => {
  it('EBITDA explícito no documento manda, sem ressalva', () => {
    const r = derivarEbitda({ ...saudavel, ebitda: 13_500_000, lucro_bruto: 27_000_000, despesas_operacionais: 5_000_000 })
    assert.equal(r.valor, 13_500_000)
    assert.equal(r.origem, 'explicito')
    assert.equal(r.ressalva, undefined)
  })

  it('sem EBITDA mas com D&A, monta EBIT + D&A sem ressalva', () => {
    const r = derivarEbitda({
      ...vazio,
      ebitda: null,
      lucro_bruto: 27_000_000,
      despesas_operacionais: 5_000_000,
      depreciacao_amortizacao: 1_200_000,
    })
    assert.equal(r.valor, 23_200_000)
    assert.equal(r.origem, 'ebit_mais_da')
    assert.equal(r.ressalva, undefined)
  })

  it('sem EBITDA e sem D&A, usa EBIT COM ressalva de que é proxy', () => {
    const r = derivarEbitda({ ...vazio, lucro_bruto: 27_000_000, despesas_operacionais: 5_000_000 })
    assert.equal(r.valor, 22_000_000)
    assert.equal(r.origem, 'ebit_proxy')
    assert.match(r.ressalva ?? '', /conservadora/)
  })

  /*
   * O caso real que originou tudo isto: DRE padrão CAIXA da ANTONINI, exercício 2025.
   * Dezesseis linhas, nenhuma delas EBITDA, depreciação ou amortização.
   */
  it('reproduz o DRE padrão CAIXA que não publica EBITDA', () => {
    const antonini2025: ExercicioContabil = {
      ...vazio,
      exercicio: 2025,
      receita_bruta: 54_746_367.3,
      receita_liquida: 52_556_512.62,
      cmv: 18_914_917.07,
      lucro_bruto: 33_641_595.55,
      despesas_operacionais: 3_941_738.42,
      resultado_equivalencia_patrimonial: 0,
      resultado_financeiro: 59_342,
      lucro_liquido: 29_759_199.13,
    }
    const r = derivarEbitda(antonini2025)
    assert.equal(r.origem, 'ebit_proxy')
    // 33.641.595,55 − 3.941.738,42
    assert.ok(Math.abs((r.valor as number) - 29_699_857.13) < 0.01)
  })

  it('custo e despesa são MAGNITUDES: o sinal do documento não inverte a conta', () => {
    const positivo = derivarEbitda({ ...vazio, lucro_bruto: 27_000_000, despesas_operacionais: 5_000_000 })
    const negativo = derivarEbitda({ ...vazio, lucro_bruto: 27_000_000, despesas_operacionais: -5_000_000 })
    assert.equal(positivo.valor, negativo.valor)
    // E o mesmo vale para o CMV, quando o lucro bruto precisa ser derivado dele.
    const comCmvNegativo = derivarEbitda({
      ...vazio,
      receita_liquida: 52_556_512.62,
      cmv: -18_914_917.07,
      despesas_operacionais: 3_941_738.42,
    })
    assert.ok(Math.abs((comCmvNegativo.valor as number) - 29_699_857.13) < 0.01)
  })

  it('o lucro bruto EXTRAÍDO tem precedência sobre o derivado do CMV', () => {
    const r = derivarEbitda({
      ...vazio,
      lucro_bruto: 30_000_000,
      receita_liquida: 50_000_000,
      cmv: 10_000_000, // daria 40M se fosse usado
      despesas_operacionais: 5_000_000,
    })
    assert.equal(r.valor, 25_000_000)
  })

  it('a equivalência patrimonial fica FORA do EBIT', () => {
    const r = derivarEbitda({
      ...vazio,
      lucro_bruto: 12_276_822.22,
      despesas_operacionais: 1_181_426.64,
      resultado_equivalencia_patrimonial: 2_275_210.9,
    })
    assert.ok(Math.abs((r.valor as number) - 11_095_395.58) < 0.01)
  })

  it('sem lucro bruto nem despesas, não há EBITDA — e o motivo diz por quê', () => {
    const r = derivarEbitda({ ...vazio, lucro_bruto: 27_000_000 })
    assert.equal(r.valor, null)
    assert.equal(r.origem, null)
    assert.match(r.motivo_sem_valor ?? '', /não publica EBITDA/)
  })

  it('o proxy chega aos indicadores COM a ressalva à vista', () => {
    const ex: ExercicioContabil = {
      ...vazio,
      receita_liquida: 52_556_512.62,
      lucro_bruto: 33_641_595.55,
      despesas_operacionais: 3_941_738.42,
      emprestimos_curto_prazo: 540_744.56,
      emprestimos_longo_prazo: 8_490_346.58,
      caixa: 1_949_869.34,
    }
    const r = calcularIndicadores(contexto({ exercicios: [ex] }), PARAMETROS_PADRAO)
    const alav = ind(r, 'divida_liquida_ebitda')
    assert.ok(alav.valor !== null, 'o indicador deixou de ficar apagado')
    assert.match(alav.ressalva ?? '', /EBIT/)
    // (540.744,56 + 8.490.346,58 − 1.949.869,34) ÷ 29.699.857,13
    assert.ok(Math.abs((alav.valor as number) - 7_081_221.8 / 29_699_857.13) < 1e-9)
    assert.match(ind(r, 'margem_ebitda').ressalva ?? '', /EBIT/)
  })

  it('indicador SEM valor não carrega ressalva — ela seria sobre um número que não existe', () => {
    const r = calcularIndicadores(contexto({ exercicios: [vazio] }), PARAMETROS_PADRAO)
    assert.equal(ind(r, 'divida_liquida_ebitda').ressalva, undefined)
  })
})

describe('CAGR de receita', () => {
  it('usa os ANOS declarados, não a contagem de exercícios', () => {
    // 100 → 121 em 2 anos = 10% a.a., mesmo que só haja duas linhas na base.
    const r = cagrReceita([
      { ...vazio, exercicio: 2022, receita_liquida: 100 },
      { ...vazio, exercicio: 2024, receita_liquida: 121 },
    ])
    assert.ok(Math.abs((r as number) - 0.1) < 1e-9)
  })

  it('um só exercício não mede crescimento', () => {
    assert.equal(cagrReceita([{ ...vazio, exercicio: 2024, receita_liquida: 100 }]), null)
  })

  it('ignora exercícios sem receita em vez de tratá-los como zero', () => {
    const r = cagrReceita([
      { ...vazio, exercicio: 2022, receita_liquida: null },
      { ...vazio, exercicio: 2023, receita_liquida: 100 },
      { ...vazio, exercicio: 2024, receita_liquida: 110 },
    ])
    assert.ok(Math.abs((r as number) - 0.1) < 1e-9)
  })
})

describe('tetos', () => {
  it('capacidade financeira é % da receita, penalizada por alavancagem e liquidez', () => {
    const r = calcularTetos(contexto(), PARAMETROS_PADRAO, calcularIndicadores(contexto(), PARAMETROS_PADRAO))
    // Saudável: sem penalidade. 100M × 10%.
    assert.equal(teto(r, 'capacidade_financeira').valor, 10_000_000)
  })

  it('aplica as duas penalidades em cadeia quando as duas disparam', () => {
    const ruim: ExercicioContabil = {
      ...saudavel,
      ativo_circulante: 20_000_000, // liquidez corrente 0,67 < 1
      emprestimos_longo_prazo: 45_000_000, // dívida líquida 43M / 13,5M = 3,2 > 3
    }
    const ctx = contexto({ exercicios: [ruim] })
    const r = calcularTetos(ctx, PARAMETROS_PADRAO, calcularIndicadores(ctx, PARAMETROS_PADRAO))
    const t = teto(r, 'capacidade_financeira')
    assert.equal(t.valor, 100_000_000 * 0.1 * 0.6 * 0.7)
  })

  it('o teto operacional NÃO É ZERO em análise inicial — ele sai da conta', () => {
    const r = calcularTetos(contexto(), PARAMETROS_PADRAO, calcularIndicadores(contexto(), PARAMETROS_PADRAO))
    const t = teto(r, 'capacidade_operacional')
    assert.equal(t.aplicavel, false)
    assert.equal(t.valor, null)
    assert.match(t.motivo_nao_aplicavel ?? '', /ainda não opera/)
    assert.equal(t.vinculante, false)
  })

  it('em reanálise, o teto operacional existe e pode ser o vinculante', () => {
    const ctx = contexto({ opera_na_plataforma: true, media_mensal_nfe: 400_000 })
    const r = calcularTetos(ctx, PARAMETROS_PADRAO, calcularIndicadores(ctx, PARAMETROS_PADRAO))
    const t = teto(r, 'capacidade_operacional')
    assert.equal(t.aplicavel, true)
    assert.equal(t.valor, 600_000)
    assert.equal(menorTeto(r)?.id, 'capacidade_operacional')
  })

  it('sem PL do fundo configurado, a concentração fica fora do mínimo', () => {
    const r = calcularTetos(contexto(), PARAMETROS_PADRAO, calcularIndicadores(contexto(), PARAMETROS_PADRAO))
    const t = teto(r, 'concentracao_portfolio')
    assert.equal(t.aplicavel, false)
    assert.equal(t.valor, null)
    // O que importa é que ela não vincula: um PL ausente lido como zero seria o menor
    // teto de todos e reprovaria a casa inteira.
    assert.equal(t.vinculante, false)
    assert.notEqual(menorTeto(r)?.id, 'concentracao_portfolio')
  })

  it('com PL configurado, a concentração entra e pode vincular', () => {
    const p = params({
      concentracao_portfolio: { pl_fundo: 50_000_000, pct_max_por_sacado: 0.1 },
    })
    const r = calcularTetos(contexto(), p, calcularIndicadores(contexto(), p))
    assert.equal(teto(r, 'concentracao_portfolio').valor, 5_000_000)
    assert.equal(menorTeto(r)?.id, 'concentracao_portfolio')
  })

  it('faixa sem banda configurada não vira banda zero', () => {
    const ctx = contexto({ faixa_score: 'dados_insuficientes' })
    const r = calcularTetos(ctx, PARAMETROS_PADRAO, calcularIndicadores(ctx, PARAMETROS_PADRAO))
    const t = teto(r, 'scorecard')
    assert.equal(t.aplicavel, false)
    assert.equal(menorTeto(r)?.id, 'capacidade_financeira')
  })

  it('empresa sem score algum: o teto do scorecard diz que ela nunca foi pontuada', () => {
    const ctx = contexto({ faixa_score: null })
    const r = calcularTetos(ctx, PARAMETROS_PADRAO, calcularIndicadores(ctx, PARAMETROS_PADRAO))
    assert.match(teto(r, 'scorecard').motivo_nao_aplicavel ?? '', /nunca foi pontuada|ainda não foi pontuada/)
  })

  it('a seguradora entra como teto quando há limite vigente', () => {
    const ctx = contexto({ limite_seguradora: 3_000_000 })
    const r = calcularTetos(ctx, PARAMETROS_PADRAO, calcularIndicadores(ctx, PARAMETROS_PADRAO))
    assert.equal(menorTeto(r)?.id, 'cobertura_seguradora')
  })

  it('exatamente um teto é vinculante', () => {
    const ctx = contexto({ limite_seguradora: 3_000_000, opera_na_plataforma: true, media_mensal_nfe: 100_000 })
    const r = calcularTetos(ctx, PARAMETROS_PADRAO, calcularIndicadores(ctx, PARAMETROS_PADRAO))
    assert.equal(r.filter((t) => t.vinculante).length, 1)
  })

  it('nenhum teto aplicável → nenhum vinculante', () => {
    const ctx = contexto({ exercicios: [vazio], faixa_score: null })
    const r = calcularTetos(ctx, PARAMETROS_PADRAO, calcularIndicadores(ctx, PARAMETROS_PADRAO))
    assert.equal(menorTeto(r), null)
    assert.equal(r.filter((t) => t.vinculante).length, 0)
  })
})

describe('knockouts e recomendação', () => {
  it('empresa saudável: OPERAR, com o limite igual ao menor teto', () => {
    const r = calcularAnalise(contexto(), PARAMETROS_PADRAO)
    assert.equal(r.recomendacao, 'operar')
    // A capacidade financeira daria 10M, mas a banda da faixa "alta" corta em 5M — e é
    // o MENOR entre os aplicáveis que vale.
    assert.equal(r.limite_recomendado, 5_000_000)
    assert.equal(menorTeto(r.tetos)?.id, 'scorecard')
    assert.deepEqual(r.motivos_nao_operar, [])
  })

  it('PL negativo derruba a análise, com motivo escrito', () => {
    const ctx = contexto({ exercicios: [{ ...saudavel, patrimonio_liquido: -1_000_000 }] })
    const r = calcularAnalise(ctx, PARAMETROS_PADRAO)
    assert.equal(r.recomendacao, 'nao_operar')
    assert.equal(r.limite_recomendado, null)
    assert.deepEqual(r.cenarios, [])
    assert.ok(r.motivos_nao_operar.some((m) => /Patrimônio líquido negativo/.test(m)))
  })

  it('knockout do scorecard derruba mesmo com balanço bom', () => {
    const r = calcularAnalise(contexto({ knockout_score: 'situacao_irregular' }), PARAMETROS_PADRAO)
    assert.equal(r.recomendacao, 'nao_operar')
    assert.ok(r.motivos_nao_operar.some((m) => /scorecard/.test(m)))
  })

  it('alavancagem acima do teto de knockout derruba', () => {
    const ctx = contexto({ exercicios: [{ ...saudavel, ebitda: 3_000_000 }] }) // 13M/3M = 4,3x
    const p = params({ knockouts: { ...PARAMETROS_PADRAO.knockouts, divida_liquida_ebitda_acima_de: 4 } })
    const r = calcularAnalise(ctx, p)
    assert.equal(r.recomendacao, 'nao_operar')
    assert.ok(r.motivos_nao_operar.some((m) => /Dívida líquida \/ EBITDA/.test(m)))
  })

  it('menor teto abaixo do mínimo operacional derruba', () => {
    const ctx = contexto({ opera_na_plataforma: true, media_mensal_nfe: 10_000 }) // teto 15k
    const r = calcularAnalise(ctx, PARAMETROS_PADRAO)
    assert.equal(r.recomendacao, 'nao_operar')
    assert.ok(r.motivos_nao_operar.some((m) => /mínimo operacional/.test(m)))
  })

  it('nenhum teto calculável é motivo explícito, não silêncio', () => {
    const ctx = contexto({ exercicios: [vazio], faixa_score: null })
    const r = calcularAnalise(ctx, PARAMETROS_PADRAO)
    assert.equal(r.recomendacao, 'nao_operar')
    assert.ok(r.motivos_nao_operar.some((m) => /nenhum dos cinco tetos/i.test(m)))
  })

  it('knockout desligado nos parâmetros não dispara', () => {
    const ctx = contexto({ exercicios: [{ ...saudavel, patrimonio_liquido: -1 }] })
    const p = params({ knockouts: { ...PARAMETROS_PADRAO.knockouts, pl_negativo: false } })
    const motivos = avaliarKnockouts(ctx, p, calcularIndicadores(ctx, p), menorTeto(calcularTetos(ctx, p, calcularIndicadores(ctx, p))))
    assert.equal(motivos.filter((m) => /Patrimônio/.test(m)).length, 0)
  })

  it('os três cenários saem do mesmo menor teto, e o base é a recomendação', () => {
    const r = calcularAnalise(contexto(), PARAMETROS_PADRAO)
    const [cons, base, agr] = r.cenarios
    assert.equal(cons?.limite, 5_000_000 * 0.7)
    assert.equal(base?.limite, 5_000_000)
    assert.equal(base?.limite, r.limite_recomendado)
    assert.equal(agr?.limite, 5_000_000 * 1.3)
    assert.ok((agr?.condicionantes ?? []).length > 0, 'o agressivo sem condicionante é só um número maior')
  })

  it('as lacunas do cálculo aparecem mesmo quando a recomendação é operar', () => {
    const r = calcularAnalise(contexto(), PARAMETROS_PADRAO)
    assert.equal(r.recomendacao, 'operar')
    assert.ok(r.lacunas_calculo.some((l) => /Capacidade operacional/.test(l)))
    assert.ok(r.lacunas_calculo.some((l) => /Concentração/.test(l)))
  })
})

describe('quadrantes e decisão', () => {
  it('classifica os quatro cruzamentos', () => {
    assert.equal(classificarQuadrante('operar', 'aprovada'), 'ambos_aprovam')
    assert.equal(classificarQuadrante('operar', 'aprovada_parcial'), 'ambos_aprovam')
    assert.equal(classificarQuadrante('operar', 'negada'), 'so_nos')
    assert.equal(classificarQuadrante('nao_operar', 'aprovada'), 'so_seguradora')
    assert.equal(classificarQuadrante('nao_operar', 'negada'), 'ambos_negam')
  })

  it('sem resposta da seguradora não há quadrante', () => {
    assert.equal(classificarQuadrante('operar', null), null)
    assert.equal(classificarQuadrante(null, 'aprovada'), null)
  })

  it('motivo é obrigatório em tudo que não seja o caminho trivial', () => {
    assert.equal(motivoObrigatorio('ambos_aprovam', 'operar_com_cobertura'), false)
    assert.equal(motivoObrigatorio('ambos_aprovam', 'nao_operar'), true)
    assert.equal(motivoObrigatorio('ambos_negam', 'nao_operar'), false)
    assert.equal(motivoObrigatorio('ambos_negam', 'operar_sem_cobertura'), true)
    // Divergência não tem caminho trivial.
    assert.equal(motivoObrigatorio('so_nos', 'operar_sem_cobertura'), true)
    assert.equal(motivoObrigatorio('so_seguradora', 'operar_com_cobertura'), true)
    assert.equal(motivoObrigatorio(null, 'nao_operar'), true)
  })
})

describe('extração', () => {
  const extraidos: DadosExtraidos = {
    exercicios: [
      {
        exercicio: 2024,
        moeda: 'BRL',
        campos: {
          receita_bruta: { valor: 100, origem: { documento_id: 'd1', pagina: 3, trecho_curto: 'Receita bruta' } },
          ebitda: { valor: 20, origem: null, revisado: true },
          patrimonio_liquido: { valor: null, origem: null },
        },
      },
    ],
    lacunas: ['PL não localizado no balanço'],
    conflitos: [],
  }

  it('achata para números puros, na ordem dos exercícios', () => {
    const r = achatarExtracao({
      ...extraidos,
      exercicios: [
        { exercicio: 2024, moeda: 'BRL', campos: { receita_bruta: { valor: 200, origem: null } } },
        { exercicio: 2023, moeda: 'BRL', campos: { receita_bruta: { valor: 100, origem: null } } },
      ],
    })
    assert.deepEqual(r.map((e) => e.exercicio), [2023, 2024])
    assert.equal(r.at(-1)?.receita_bruta, 200)
    assert.equal(r.at(-1)?.ebitda, null)
  })

  it('extração vazia não quebra o achatamento', () => {
    assert.deepEqual(achatarExtracao(null), [])
    assert.deepEqual(achatarExtracao({ exercicios: [], lacunas: [], conflitos: [] }), [])
  })

  it('crítico com valor e sem revisão fica pendente', () => {
    const p = criticosPendentes(extraidos)
    assert.deepEqual(p, [{ exercicio: 2024, campo: 'receita_bruta' }])
  })

  it('crítico já revisado sai da fila', () => {
    const p = criticosPendentes({
      ...extraidos,
      exercicios: [
        {
          exercicio: 2024,
          moeda: 'BRL',
          campos: { receita_bruta: { valor: 100, origem: null, revisado: true } },
        },
      ],
    })
    assert.deepEqual(p, [])
  })

  it('crítico ausente é lacuna, não revisão pendente — não se confirma linha em branco', () => {
    const p = criticosPendentes({
      ...extraidos,
      exercicios: [{ exercicio: 2024, moeda: 'BRL', campos: { ebitda: { valor: null, origem: null } } }],
    })
    assert.deepEqual(p, [])
  })
})
