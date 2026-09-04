import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MATRIZ_PADRAO,
  calcularTac,
  colunaDeScore,
  derivarDoD0,
  faixaDeFaturamento,
  montarPayloadProducao,
  payloadProducaoSchema,
  simularTac,
  sugerirCondicoes,
  validadeEm,
  validarCondicoes,
  type CondicoesFormulario,
  type ContextoPrecificacao,
} from './precificacao.ts'

// ─── §4 A TAC proporcional ──────────────────────────────────────────────────

test('a TAC cresce com o valor da nota até o limiar — fee_min NÃO é piso', () => {
  const tac = (v: number) => calcularTac(v, 300, 150, 10_000)
  // Os três exemplos do 04o §4, na ordem em que ele os escreve.
  assert.equal(tac(10_000), 300)
  assert.equal(tac(5_000), 225)
  assert.equal(tac(1_000), 165)
})

test('acima do limiar a TAC para de crescer: é teto, não rampa infinita', () => {
  assert.equal(calcularTac(50_000, 300, 150, 10_000), 300)
  assert.equal(calcularTac(1_000_000, 300, 150, 10_000), 300)
})

test('a leitura errada (fee_min como piso) cobraria 30% da nota de mil reais', () => {
  // Este teste existe para documentar o erro que ele evita: com fee_min tratado como
  // piso de segurança, a NF de R$ 1.000 pagaria a TAC cheia de R$ 300.
  const correto = calcularTac(1_000, 300, 150, 10_000)
  assert.equal(correto, 165)
  assert.ok(correto < 300)
})

test('nota sem valor não gera TAC, e limiar zerado devolve a TAC cheia', () => {
  assert.equal(calcularTac(0, 300, 150, 10_000), 0)
  assert.equal(calcularTac(-5, 300, 150, 10_000), 0)
  assert.equal(calcularTac(1_000, 300, 150, 0), 300)
})

test('o simulador mostra a regressividade: a taxa efetiva do ticket pequeno é a maior', () => {
  const linhas = simularTac(
    {
      monthly_rate_d0: 2.9,
      monthly_rate_d1: 2.674,
      fee_d0: 300,
      fee_min_d0: 150,
      fee_d1: 250,
      fee_min_d1: 125,
    },
    10_000,
  )
  assert.deepEqual(
    linhas.map((l) => l.valor_nf),
    [1_000, 5_000, 10_000, 50_000],
  )
  // Com prazo de 30 dias, a parcela de juros da taxa efetiva É a taxa mensal.
  const mil = linhas[0]!
  assert.equal(mil.juros_d0, 29)
  assert.equal(mil.tac_d0, 165)
  assert.equal(mil.custo_total_d0, 194)
  assert.equal(Math.round(mil.taxa_efetiva_d0 * 100) / 100, 19.4)
  // 19,4% na nota de mil contra 3,5% na de cinquenta mil: mesma tabela, preços opostos.
  const cinquenta = linhas[3]!
  assert.ok(cinquenta.taxa_efetiva_d0 < mil.taxa_efetiva_d0)
  assert.equal(Math.round(cinquenta.taxa_efetiva_d0 * 100) / 100, 3.5)
  // E o D1 é sempre mais barato que o D0, em todos os tickets.
  for (const l of linhas) assert.ok(l.custo_total_d1 < l.custo_total_d0)
})

// ─── §3 Faixas e célula ─────────────────────────────────────────────────────

test('a faixa de faturamento é por limite superior exclusivo, e sem faturamento cai na menor', () => {
  assert.equal(faixaDeFaturamento(4_999_999), 'micro')
  assert.equal(faixaDeFaturamento(5_000_000), 'pequena')
  assert.equal(faixaDeFaturamento(20_000_000), 'media')
  assert.equal(faixaDeFaturamento(100_000_000), 'grande')
  assert.equal(faixaDeFaturamento(500_000_000), 'corporate')
  assert.equal(faixaDeFaturamento(null), 'micro')
  assert.equal(faixaDeFaturamento(0), 'micro')
})

test('dados_insuficientes é precificado como improvável, nunca como média', () => {
  assert.equal(colunaDeScore('alta'), 'alta')
  assert.equal(colunaDeScore('media'), 'media')
  assert.equal(colunaDeScore('improvavel'), 'improvavel')
  assert.equal(colunaDeScore('dados_insuficientes'), 'improvavel')
  assert.equal(colunaDeScore(null), 'improvavel')
})

test('a semente vai de 1,9%/R$150 (grande e boa) a 3,4%/R$300 (pequena e ruim)', () => {
  const melhor = MATRIZ_PADRAO.celulas.corporate.alta
  const pior = MATRIZ_PADRAO.celulas.micro.improvavel
  assert.equal(melhor.monthly_rate_d0, MATRIZ_PADRAO.faixas.juros.d0_min)
  assert.equal(melhor.fee_d0, MATRIZ_PADRAO.faixas.tac.fee_d0_min)
  assert.equal(pior.monthly_rate_d0, MATRIZ_PADRAO.faixas.juros.d0_max)
  assert.equal(pior.fee_d0, MATRIZ_PADRAO.faixas.tac.fee_d0_max)
})

// ─── §3 Derivação do D1 e dos fee_min ───────────────────────────────────────

test('o D1 derivado é sempre mais barato que o D0, em toda a faixa de juros', () => {
  for (let r = 1.9; r <= 3.4001; r += 0.05) {
    const d = derivarDoD0(Number(r.toFixed(3)), 220, MATRIZ_PADRAO.faixas)
    assert.ok(d.monthly_rate_d1 < r, `D1 ${d.monthly_rate_d1} deveria ser menor que D0 ${r}`)
    assert.ok(d.monthly_rate_d1 > 0)
  }
})

test('os fee_min saem do percentual da config e nunca passam do fee cheio', () => {
  const d = derivarDoD0(2.9, 300, MATRIZ_PADRAO.faixas)
  assert.equal(d.fee_min_d0, 150) // 300 × 0,5
  assert.ok(d.fee_d1 < 300)
  assert.equal(d.fee_min_d1, Math.round(d.fee_d1 * 0.5 * 100) / 100)
  assert.ok(d.fee_min_d1 <= d.fee_d1)
})

test('quem paga barato em D0 ganha o desconto maior — a graduação é da config', () => {
  const barato = derivarDoD0(1.9, 220, MATRIZ_PADRAO.faixas)
  const caro = derivarDoD0(3.4, 220, MATRIZ_PADRAO.faixas)
  assert.equal(Math.round((1.9 - barato.monthly_rate_d1) * 1000) / 1000, 0.6)
  assert.equal(Math.round((3.4 - caro.monthly_rate_d1) * 1000) / 1000, 0.1)
})

// ─── §3 O motor de sugestão ─────────────────────────────────────────────────

const HOJE = new Date(2026, 8, 4) // 04/09/2026

const CTX_BASE: ContextoPrecificacao = {
  faturamento_estimado: 30_000_000,
  faixa_score: 'media',
  cobertura_vigente: false,
  tem_protesto: false,
  prazo_medio_nf_dias: 45,
  ticket_medio_nf: 40_000,
  limite_aprovado: 500_000,
  limite_recomendado: 420_000,
  hoje: HOJE,
}

test('a sugestão sai da célula da matriz e diz qual célula usou', () => {
  const { condicoes, explicacao } = sugerirCondicoes(CTX_BASE, MATRIZ_PADRAO)
  assert.equal(explicacao.faixa_faturamento, 'media')
  assert.equal(explicacao.coluna_score, 'media')
  assert.equal(condicoes.monthly_rate_d0, MATRIZ_PADRAO.celulas.media.media.monthly_rate_d0)
  assert.equal(condicoes.fee_d0, MATRIZ_PADRAO.celulas.media.media.fee_d0)
  assert.deepEqual(explicacao.ajustes_aplicados, [])
})

test('cobertura da seguradora barateia; protesto encarece — e os dois ficam registrados', () => {
  const semNada = sugerirCondicoes(CTX_BASE, MATRIZ_PADRAO).condicoes
  const comCobertura = sugerirCondicoes({ ...CTX_BASE, cobertura_vigente: true }, MATRIZ_PADRAO)
  const comProtesto = sugerirCondicoes({ ...CTX_BASE, tem_protesto: true }, MATRIZ_PADRAO)

  assert.ok(comCobertura.condicoes.monthly_rate_d0 < semNada.monthly_rate_d0)
  assert.ok(comProtesto.condicoes.monthly_rate_d0 > semNada.monthly_rate_d0)
  assert.deepEqual(
    comCobertura.explicacao.ajustes_aplicados.map((a) => a.id),
    ['cobertura_atradius'],
  )
  assert.deepEqual(
    comProtesto.explicacao.ajustes_aplicados.map((a) => a.id),
    ['protesto'],
  )
})

test('prazo longo e ticket pequeno entram como ajustes próprios', () => {
  const s = sugerirCondicoes(
    { ...CTX_BASE, prazo_medio_nf_dias: 120, ticket_medio_nf: 2_000 },
    MATRIZ_PADRAO,
  )
  assert.deepEqual(s.explicacao.ajustes_aplicados.map((a) => a.id).sort(), [
    'prazo_medio_alto',
    'ticket_medio_baixo',
  ])
})

test('os ajustes NÃO furam a faixa global: o teto é o teto', () => {
  const s = sugerirCondicoes(
    {
      ...CTX_BASE,
      faturamento_estimado: 1_000_000,
      faixa_score: 'improvavel',
      tem_protesto: true,
      prazo_medio_nf_dias: 200,
      ticket_medio_nf: 1_000,
    },
    MATRIZ_PADRAO,
  )
  assert.equal(s.condicoes.monthly_rate_d0, MATRIZ_PADRAO.faixas.juros.d0_max)
  assert.equal(s.condicoes.fee_d0, MATRIZ_PADRAO.faixas.tac.fee_d0_max)
  assert.equal(s.condicoes.commission_percent, MATRIZ_PADRAO.faixas.comissao.max)
})

test('a sugestão sempre passa na própria validação — as 25 células, com e sem ajuste', () => {
  for (const fat of [1_000_000, 10_000_000, 50_000_000, 200_000_000, 900_000_000]) {
    for (const faixa of ['alta', 'media', 'improvavel', 'dados_insuficientes']) {
      for (const cobertura of [false, true]) {
        for (const protesto of [false, true]) {
          const s = sugerirCondicoes(
            {
              ...CTX_BASE,
              faturamento_estimado: fat,
              faixa_score: faixa,
              cobertura_vigente: cobertura,
              tem_protesto: protesto,
            },
            MATRIZ_PADRAO,
          )
          const r = validarCondicoes(s.condicoes, MATRIZ_PADRAO, HOJE)
          assert.deepEqual(r.erros, [], `${fat}/${faixa} devolveu erros`)
          assert.deepEqual(r.foras_de_faixa, [], `${fat}/${faixa} saiu da faixa global`)
        }
      }
    }
  }
})

test('has_insurance é derivado da cobertura, e o limite vem da esteira antes da análise própria', () => {
  const comEsteira = sugerirCondicoes({ ...CTX_BASE, cobertura_vigente: true }, MATRIZ_PADRAO)
  assert.equal(comEsteira.condicoes.has_insurance, true)
  assert.equal(comEsteira.condicoes.credit_limit, 500_000)
  assert.equal(comEsteira.explicacao.origem_credit_limit, 'esteira')

  const semEsteira = sugerirCondicoes({ ...CTX_BASE, limite_aprovado: null }, MATRIZ_PADRAO)
  assert.equal(semEsteira.condicoes.credit_limit, 420_000)
  assert.equal(semEsteira.explicacao.origem_credit_limit, 'analise_propria')

  const semNada = sugerirCondicoes(
    { ...CTX_BASE, limite_aprovado: null, limite_recomendado: null },
    MATRIZ_PADRAO,
  )
  assert.equal(semNada.explicacao.origem_credit_limit, 'sem_limite')
  // Sem limite a sugestão não inventa um: fica zero, e o validador barra a publicação.
  assert.equal(semNada.condicoes.credit_limit, 0)
  assert.equal(validarCondicoes(semNada.condicoes, MATRIZ_PADRAO, HOJE).ok, false)
})

test('os fixos vêm da config, não do formulário', () => {
  const c = sugerirCondicoes(CTX_BASE, MATRIZ_PADRAO).condicoes
  assert.equal(c.bill_fine_percent, 2)
  assert.equal(c.extension_rate_percent, 12)
  assert.equal(c.invest_back_limit, 0)
  assert.equal(c.invest_back_commission_percent, 0)
  assert.equal(c.has_referral, false)
  assert.equal(c.fidc_ready, true)
  assert.equal(c.max_invoice_amount, 1_000_000)
  assert.equal(c.max_due_date_days, 90)
})

test('a validade é hoje + os meses da config, em AAAA-MM-DD', () => {
  assert.equal(validadeEm(12, HOJE), '2027-09-04')
  assert.equal(sugerirCondicoes(CTX_BASE, MATRIZ_PADRAO).condicoes.expires_at, '2027-09-04')
  // Virada de mês curto: 31/01 + 1 mês não existe, e a data precisa continuar válida.
  assert.match(validadeEm(1, new Date(2026, 0, 31)), /^\d{4}-\d{2}-\d{2}$/)
})

// ─── §3 O validador ─────────────────────────────────────────────────────────

const OK: CondicoesFormulario = {
  credit_limit: 500_000,
  max_invoice_amount: 1_000_000,
  max_due_date_days: 90,
  expires_at: '2027-09-04',
  monthly_rate_d0: 2.9,
  monthly_rate_d1: 2.674,
  fee_d0: 300,
  fee_min_d0: 150,
  fee_d1: 250,
  fee_min_d1: 125,
  commission_percent: 2.5,
  extension_rate_percent: 12,
  bill_fine_percent: 2,
  invest_back_limit: 0,
  invest_back_commission_percent: 0,
  has_insurance: false,
  has_referral: false,
  fidc_ready: true,
}

const erroEm = (c: Partial<CondicoesFormulario>): string[] =>
  validarCondicoes({ ...OK, ...c }, MATRIZ_PADRAO, HOJE).erros.map((e) => e.campo)

test('o exemplo do contrato de produção, corrigido, é válido', () => {
  assert.equal(validarCondicoes(OK, MATRIZ_PADRAO, HOJE).ok, true)
})

test('cruzada 1: D0 invertido em relação ao D1 é recusado nas duas pontas', () => {
  assert.deepEqual(erroEm({ monthly_rate_d0: 2.0, monthly_rate_d1: 2.674 }), ['monthly_rate_d1'])
  // Iguais também: D0 tem de ser ESTRITAMENTE maior.
  assert.deepEqual(erroEm({ monthly_rate_d1: 2.9 }), ['monthly_rate_d1'])
  assert.deepEqual(erroEm({ fee_d0: 200 }), ['fee_d1'])
  assert.deepEqual(erroEm({ fee_d1: 300 }), ['fee_d1'])
})

test('cruzada 2: fee_min acima do fee é recusado nos dois produtos', () => {
  assert.deepEqual(erroEm({ fee_min_d0: 301 }), ['fee_min_d0'])
  assert.deepEqual(erroEm({ fee_min_d1: 251 }), ['fee_min_d1'])
  // Igual ao fee é permitido: TAC plana, sem proporcionalidade.
  assert.equal(validarCondicoes({ ...OK, fee_min_d0: 300 }, MATRIZ_PADRAO, HOJE).ok, true)
})

test('cruzada 3: invest back não passa do limite de crédito', () => {
  assert.deepEqual(erroEm({ invest_back_limit: 500_001 }), ['invest_back_limit'])
  assert.equal(
    validarCondicoes({ ...OK, invest_back_limit: 500_000 }, MATRIZ_PADRAO, HOJE).ok,
    true,
  )
})

test('os limites de faixa do contrato deles', () => {
  assert.deepEqual(erroEm({ max_invoice_amount: 499 }), ['max_invoice_amount'])
  assert.deepEqual(erroEm({ max_invoice_amount: 10_000_001 }), ['max_invoice_amount'])
  assert.equal(validarCondicoes({ ...OK, max_invoice_amount: 500 }, MATRIZ_PADRAO, HOJE).ok, true)
  assert.equal(
    validarCondicoes({ ...OK, max_invoice_amount: 10_000_000 }, MATRIZ_PADRAO, HOJE).ok,
    true,
  )

  assert.deepEqual(erroEm({ max_due_date_days: 4 }), ['max_due_date_days'])
  assert.deepEqual(erroEm({ max_due_date_days: 366 }), ['max_due_date_days'])
  assert.deepEqual(erroEm({ max_due_date_days: 90.5 }), ['max_due_date_days'])
  assert.equal(validarCondicoes({ ...OK, max_due_date_days: 5 }, MATRIZ_PADRAO, HOJE).ok, true)
  assert.equal(validarCondicoes({ ...OK, max_due_date_days: 365 }, MATRIZ_PADRAO, HOJE).ok, true)

  assert.deepEqual(erroEm({ credit_limit: 0 }), ['credit_limit'])
  assert.deepEqual(erroEm({ commission_percent: 100 }), ['commission_percent'])
  assert.deepEqual(erroEm({ commission_percent: -0.1 }), ['commission_percent'])
})

test('a validade precisa ser futura, existente e em AAAA-MM-DD', () => {
  assert.deepEqual(erroEm({ expires_at: '04/09/2027' }), ['expires_at'])
  assert.deepEqual(erroEm({ expires_at: '2026-09-04' }), ['expires_at']) // hoje não é futuro
  assert.deepEqual(erroEm({ expires_at: '2027-02-30' }), ['expires_at'])
  assert.equal(validarCondicoes({ ...OK, expires_at: '2026-09-05' }, MATRIZ_PADRAO, HOJE).ok, true)
})

test('fora da faixa global não é erro — é permissão com justificativa', () => {
  const r = validarCondicoes({ ...OK, monthly_rate_d0: 4.5 }, MATRIZ_PADRAO, HOJE)
  assert.equal(r.ok, true)
  assert.deepEqual(r.foras_de_faixa, [{ campo: 'monthly_rate_d0', valor: 4.5, min: 1.9, max: 3.4 }])
})

// ─── §7 O payload de produção ───────────────────────────────────────────────

test('com cadastro na plataforma vai companyId; sem cadastro, document + subjectName', () => {
  const comId = montarPayloadProducao(OK, {
    onepay_company_id: 748,
    cnpj: '11222333000181',
    razao_social: 'CONSTRUTORA EXEMPLO LTDA',
  })
  assert.equal(comId.companyId, 748)
  assert.equal('document' in comId, false)
  assert.equal('subjectName' in comId, false)

  const semId = montarPayloadProducao(OK, {
    onepay_company_id: null,
    cnpj: '11222333000181',
    razao_social: 'CONSTRUTORA EXEMPLO LTDA',
  })
  assert.equal('companyId' in semId, false)
  assert.equal(semId.document, '11222333000181')
  assert.equal(semId.subjectName, 'CONSTRUTORA EXEMPLO LTDA')
})

test('role é sempre PAYER e status sempre APPROVED', () => {
  const p = montarPayloadProducao(OK, {
    onepay_company_id: 1,
    cnpj: '11222333000181',
    razao_social: 'X',
  })
  assert.equal(p.role, 'PAYER')
  assert.equal(p.status, 'APPROVED')
})

test('o payload montado passa no espelho do Zod deles', () => {
  const p = montarPayloadProducao(OK, {
    onepay_company_id: 748,
    cnpj: '11222333000181',
    razao_social: 'X',
  })
  assert.equal(payloadProducaoSchema.safeParse(p).success, true)
  const semId = montarPayloadProducao(OK, {
    onepay_company_id: null,
    cnpj: '11222333000181',
    razao_social: 'X',
  })
  assert.equal(payloadProducaoSchema.safeParse(semId).success, true)
})

test('mandar companyId E document é erro no contrato deles', () => {
  const base = montarPayloadProducao(OK, {
    onepay_company_id: 748,
    cnpj: '11222333000181',
    razao_social: 'X',
  })
  const r = payloadProducaoSchema.safeParse({
    ...base,
    document: '11222333000181',
    subjectName: 'X',
  })
  assert.equal(r.success, false)
})

test('sem companyId e sem subjectName o contrato deles recusa', () => {
  const base = montarPayloadProducao(OK, {
    onepay_company_id: null,
    cnpj: '11222333000181',
    razao_social: 'X',
  })
  const { subjectName: _ignorado, ...semNome } = base
  assert.equal(payloadProducaoSchema.safeParse(semNome).success, false)
})

test('o Zod de produção repete as três cruzadas — nada passa por ele que não passe no formulário', () => {
  const ident = {
    onepay_company_id: 748,
    cnpj: '11222333000181',
    razao_social: 'X',
  }
  const invertido = montarPayloadProducao({ ...OK, monthly_rate_d1: 3.5 }, ident)
  assert.equal(payloadProducaoSchema.safeParse(invertido).success, false)
  const feeInvertido = montarPayloadProducao({ ...OK, fee_d1: 400 }, ident)
  assert.equal(payloadProducaoSchema.safeParse(feeInvertido).success, false)
  const investBack = montarPayloadProducao({ ...OK, invest_back_limit: 900_000 }, ident)
  assert.equal(payloadProducaoSchema.safeParse(investBack).success, false)
})
