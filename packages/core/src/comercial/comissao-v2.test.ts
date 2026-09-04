import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agruparDerivaPorConta,
  calcularVOP,
  compararLancamentos,
  comissaoDoVop,
  competenciaSp,
  determinarFase,
  diaSp,
  estornosDaCessao,
  explicarCalculo,
  gestaoNaData,
  idadeEmMeses,
  lancamentoSdrContaFechada,
  lancamentoSdrReuniao,
  lancamentosDaCessao,
  resolverParametro,
  simularComissao,
  sugereRevisao,
  valorParametro,
  type CessaoConvertida,
  type CommissionParam,
  type LancamentoOriginal,
  type TitularesDaCessao,
} from './comissao-v2.ts'

/**
 * Estes testes existem para uma coisa só: garantir que o motor responde sobre a DATA DO
 * EVENTO, não sobre hoje. Cada caso de borda do §8 tem um teste com o nome do caso, e é
 * de propósito — quando um deles quebrar, o que se lê é a regra de negócio violada, não
 * uma asserção sobre um número.
 */

const DE = '2026-01-01'

function param(o: Partial<CommissionParam> & { chave: string; valor: number }): CommissionParam {
  return {
    id: `${o.chave}-${o.vendedor_id ?? 'geral'}-${o.vigente_de ?? DE}`,
    vendedor_id: null,
    unidade: 'BRL_PER_MM',
    vigente_de: DE,
    vigente_ate: null,
    ...o,
  }
}

/** O conjunto de seeds do §2, vigente desde 01/01/2026. */
const PARAMS: CommissionParam[] = [
  param({ chave: 'dias_referencia_vop', valor: 30, unidade: 'DAYS' }),
  param({ chave: 'orig_prospeccao_ativa', valor: 600 }),
  param({ chave: 'orig_passivo', valor: 600 }),
  param({ chave: 'vend_prospeccao_ativa_crescimento', valor: 1000 }),
  param({ chave: 'vend_prospeccao_ativa_manutencao', valor: 600 }),
  param({ chave: 'vend_passivo_crescimento', valor: 400 }),
  param({ chave: 'vend_passivo_manutencao', valor: 200 }),
  param({ chave: 'fase_crescimento_prospeccao_ativa_meses', valor: 6, unidade: 'MONTHS' }),
  param({ chave: 'fase_crescimento_passivo_meses', valor: 6, unidade: 'MONTHS' }),
  param({ chave: 'sunset_vendedor_prospeccao_ativa_meses', valor: 24, unidade: 'MONTHS' }),
  param({ chave: 'sunset_vendedor_passivo_meses', valor: 18, unidade: 'MONTHS' }),
  param({ chave: 'sdr_valor_reuniao', valor: 200, unidade: 'BRL' }),
  param({ chave: 'sdr_valor_conta_fechada', valor: 1500, unidade: 'BRL' }),
  param({ chave: 'janela_atribuicao_sdr_dias', valor: 180, unidade: 'DAYS' }),
]

const CESSAO: CessaoConvertida = {
  origemId: 'chave-nf-1',
  antecipacaoId: 4242,
  convertidaEm: '2026-03-10T14:00:00Z',
  valorCedido: 500_000,
  anticipationDays: 45,
  empresaId: 'sacado-1',
  sacadoNome: 'Construtora Alfa',
  cedenteCnpj: '11111111000191',
  cedenteNome: 'Fornecedor Beta',
  nfNumero: '9001',
  gestaoOperacao: 'prospeccao_ativa',
  marcoAtivacao: '2026-01-05',
}

const TITULARES: TitularesDaCessao = {
  vendedor: [{ vendedorId: 'vend-1', sharePct: 100, isIa: false }],
  originador: [{ vendedorId: 'orig-1', sharePct: 100, isIa: false }],
}

// ─── VOP ────────────────────────────────────────────────────────────────────

test('VOP pondera o valor cedido pelo prazo — o exemplo do §7.3', () => {
  const vop = calcularVOP(500_000, 45, 30)
  assert.equal(vop, 750_000)
  assert.equal(comissaoDoVop(vop, 600), 450)
})

test('VOP usa anticipationDays do payload, não uma conta por datas', () => {
  // 30 dias com referência 30 é o próprio valor cedido: a ponderação é neutra ali.
  assert.equal(calcularVOP(1_000_000, 30, 30), 1_000_000)
  assert.equal(calcularVOP(1_000_000, 15, 30), 500_000)
})

test('VOP inválido (sem valor, sem prazo ou sem referência) é zero, não NaN', () => {
  assert.equal(calcularVOP(0, 45, 30), 0)
  assert.equal(calcularVOP(500_000, 0, 30), 0)
  assert.equal(calcularVOP(500_000, 45, 0), 0)
})

// ─── Resolução de parâmetro ─────────────────────────────────────────────────

test('o parâmetro é o que valia NA DATA DO EVENTO, não o de hoje', () => {
  const antigo = param({ chave: 'orig_passivo', valor: 500, vigente_de: '2026-01-01', vigente_ate: '2026-03-01' })
  const novo = param({ chave: 'orig_passivo', valor: 600, vigente_de: '2026-03-01' })
  assert.equal(valorParametro([antigo, novo], 'orig_passivo', null, '2026-02-20'), 500)
  assert.equal(valorParametro([antigo, novo], 'orig_passivo', null, '2026-03-01'), 600)
})

test('vigente_ate é EXCLUSIVO: o último dia coberto é a véspera', () => {
  const p = param({ chave: 'orig_passivo', valor: 500, vigente_de: '2026-01-01', vigente_ate: '2026-02-01' })
  assert.ok(resolverParametro([p], 'orig_passivo', null, '2026-01-31'))
  assert.equal(resolverParametro([p], 'orig_passivo', null, '2026-02-01'), null)
})

test('override do vendedor vence o parâmetro geral — e só para ele', () => {
  const geral = param({ chave: 'sdr_valor_reuniao', valor: 200, unidade: 'BRL' })
  const dela = param({ chave: 'sdr_valor_reuniao', valor: 350, unidade: 'BRL', vendedor_id: 'sdr-1' })
  assert.equal(valorParametro([geral, dela], 'sdr_valor_reuniao', 'sdr-1', '2026-03-01'), 350)
  assert.equal(valorParametro([geral, dela], 'sdr_valor_reuniao', 'sdr-2', '2026-03-01'), 200)
})

test('parâmetro ausente devolve null — ausência é um valor, não zero', () => {
  assert.equal(valorParametro(PARAMS, 'sunset_originador_meses', null, '2026-03-01'), null)
})

// ─── Fase e idade ───────────────────────────────────────────────────────────

test('idade em meses conta meses COMPLETOS', () => {
  assert.equal(idadeEmMeses('2026-01-15', '2026-07-14'), 5)
  assert.equal(idadeEmMeses('2026-01-15', '2026-07-15'), 6)
  assert.equal(idadeEmMeses('2026-07-15', '2026-01-15'), 0)
})

test('fase: ≤ crescimento, > crescimento e ≤ sunset, > sunset', () => {
  const base = { gestaoOperacao: 'prospeccao_ativa' as const, mesesCrescimento: 6, mesesSunset: 24 }
  assert.equal(determinarFase({ ...base, marcoAtivacao: '2026-01-01', data: '2026-07-01' }), 'CRESCIMENTO')
  assert.equal(determinarFase({ ...base, marcoAtivacao: '2026-01-01', data: '2026-08-01' }), 'MANUTENCAO')
  assert.equal(determinarFase({ ...base, marcoAtivacao: '2024-01-01', data: '2026-02-01' }), 'RESIDUAL')
})

test('conta sem marco de ativação está nascendo agora: CRESCIMENTO', () => {
  assert.equal(
    determinarFase({
      marcoAtivacao: null,
      gestaoOperacao: 'passivo',
      data: '2026-03-01',
      mesesCrescimento: 6,
      mesesSunset: 18,
    }),
    'CRESCIMENTO',
  )
})

test('sem sunset publicado a conta nunca entra em residual', () => {
  assert.equal(
    determinarFase({
      marcoAtivacao: '2010-01-01',
      gestaoOperacao: 'passivo',
      data: '2026-03-01',
      mesesCrescimento: 6,
      mesesSunset: null,
    }),
    'MANUTENCAO',
  )
})

// ─── Classificação na data (§8, primeira linha) ─────────────────────────────

test('§8 — conversão NA DATA da mudança vale a classificação ANTERIOR', () => {
  const historico = [
    { valor_anterior: 'prospeccao_ativa', valor_novo: 'passivo', alterado_em: '2026-03-10T09:00:00Z' },
  ]
  assert.equal(gestaoNaData('passivo', historico, '2026-03-10'), 'prospeccao_ativa')
  assert.equal(gestaoNaData('passivo', historico, '2026-03-11'), 'passivo')
})

/*
 * A tag existe para o caso em que o relógio está certo e o julgamento é outro. O sunset
 * não: passar dele é o FIM do direito do vendedor, não uma fase mais barata.
 */
test('a tag manual decide entre crescimento e manutenção', () => {
  const base = { gestaoOperacao: 'prospeccao_ativa' as const, mesesCrescimento: 6, mesesSunset: 24 }
  // 2 meses de idade: o relógio diria crescimento; a tag diz manutenção.
  assert.equal(
    determinarFase({ ...base, marcoAtivacao: '2026-01-01', data: '2026-03-01', faseManual: 'MANUTENCAO' }),
    'MANUTENCAO',
  )
  // 12 meses: o relógio diria manutenção; a tag diz crescimento.
  assert.equal(
    determinarFase({ ...base, marcoAtivacao: '2025-01-01', data: '2026-01-01', faseManual: 'CRESCIMENTO' }),
    'CRESCIMENTO',
  )
})

test('o sunset vence a tag — e é a única coisa que vence', () => {
  const base = { gestaoOperacao: 'prospeccao_ativa' as const, mesesCrescimento: 6, mesesSunset: 24 }
  assert.equal(
    determinarFase({ ...base, marcoAtivacao: '2023-01-01', data: '2026-01-01', faseManual: 'CRESCIMENTO' }),
    'RESIDUAL',
  )
})

test('sem marco, a tag ainda decide — a cessão é o próprio marco', () => {
  const base = { gestaoOperacao: 'passivo' as const, mesesCrescimento: 6, mesesSunset: 18 }
  assert.equal(determinarFase({ ...base, marcoAtivacao: null, data: '2026-01-01' }), 'CRESCIMENTO')
  assert.equal(
    determinarFase({ ...base, marcoAtivacao: null, data: '2026-01-01', faseManual: 'MANUTENCAO' }),
    'MANUTENCAO',
  )
})

test('sem histórico, a classificação é a atual', () => {
  assert.equal(gestaoNaData('passivo', [], '2026-03-10'), 'passivo')
})

test('antes da primeira mudança registrada, vale o valor anterior dela', () => {
  const historico = [
    { valor_anterior: 'prospeccao_ativa', valor_novo: 'passivo', alterado_em: '2026-06-01T09:00:00Z' },
  ]
  assert.equal(gestaoNaData('passivo', historico, '2026-02-01'), 'prospeccao_ativa')
})

/*
 * Registrar pela primeira vez não é reclassificar. O §8 protege a taxa sob a qual alguém
 * trabalhou; quando não havia taxa, o que ele estaria protegendo é o zero.
 */
test('a PRIMEIRA classificação vale desde sempre, não a partir do dia seguinte', () => {
  const historico = [
    { valor_anterior: null, valor_novo: 'passivo', alterado_em: '2026-06-01T09:00:00Z' },
  ]
  assert.equal(gestaoNaData('passivo', historico, '2026-02-01'), 'passivo')
  assert.equal(gestaoNaData('passivo', historico, '2026-06-01'), 'passivo')
})

test('mas a reclassificação SEGUINTE continua valendo só do dia seguinte', () => {
  const historico = [
    { valor_anterior: null, valor_novo: 'passivo', alterado_em: '2026-06-01T09:00:00Z' },
    { valor_anterior: 'passivo', valor_novo: 'prospeccao_ativa', alterado_em: '2026-08-10T09:00:00Z' },
  ]
  assert.equal(gestaoNaData('prospeccao_ativa', historico, '2026-08-10'), 'passivo')
  assert.equal(gestaoNaData('prospeccao_ativa', historico, '2026-08-11'), 'prospeccao_ativa')
})

// ─── O motor ────────────────────────────────────────────────────────────────

test('uma cessão convertida gera vendedor + originador, cada um com seu snapshot', () => {
  const ls = lancamentosDaCessao(CESSAO, TITULARES, PARAMS)
  assert.equal(ls.length, 2)

  const vend = ls.find((l) => l.papel === 'VENDEDOR')!
  const orig = ls.find((l) => l.papel === 'ORIGINADOR')!
  // Conta ativa com 2 meses de marco: crescimento, R$ 1.000/MM sobre 750.000 de VOP.
  assert.equal(vend.fase, 'CRESCIMENTO')
  assert.equal(vend.vop, 750_000)
  assert.equal(vend.taxa_brl_por_mm, 1000)
  assert.equal(vend.valor, 750)
  assert.equal(orig.taxa_brl_por_mm, 600)
  assert.equal(orig.valor, 450)
  assert.equal(vend.competencia, '2026-03-01')
  assert.equal(orig.origem_tipo, 'nf_convertida')
  assert.equal(orig.origem_id, 'chave-nf-1')
})

test('§8 — conversão após o sunset do vendedor: taxa dele é 0, originador segue', () => {
  const antiga = { ...CESSAO, marcoAtivacao: '2023-01-01' }
  const ls = lancamentosDaCessao(antiga, TITULARES, PARAMS)
  assert.equal(ls.length, 1)
  assert.equal(ls[0]!.papel, 'ORIGINADOR')
  assert.equal(ls[0]!.fase, 'RESIDUAL')
})

test('§8 — sacado sem vendedor titular: a parcela não é paga NEM redistribuída', () => {
  const ls = lancamentosDaCessao(CESSAO, { vendedor: [], originador: TITULARES.originador }, PARAMS)
  assert.equal(ls.length, 1)
  assert.equal(ls[0]!.papel, 'ORIGINADOR')
  // O originador continua ganhando exatamente o que ganharia: nada foi transferido.
  assert.equal(ls[0]!.valor, 450)
})

test('§8 — cedente sem originador titular: idem', () => {
  const ls = lancamentosDaCessao(CESSAO, { vendedor: TITULARES.vendedor, originador: [] }, PARAMS)
  assert.equal(ls.length, 1)
  assert.equal(ls[0]!.papel, 'VENDEDOR')
  assert.equal(ls[0]!.valor, 750)
})

test('§8 — vendedor de IA titular não gera lançamento, nem para a casa', () => {
  const ls = lancamentosDaCessao(
    CESSAO,
    {
      vendedor: [{ vendedorId: 'carina', sharePct: 100, isIa: true }],
      originador: [{ vendedorId: 'orig-ia', sharePct: 100, isIa: true }],
    },
    PARAMS,
  )
  assert.deepEqual(ls, [])
})

test('§8 — cedente com mais de um sacado: cada cessão usa a classificação do SEU sacado', () => {
  const ativa = lancamentosDaCessao(CESSAO, TITULARES, PARAMS)
  const passiva = lancamentosDaCessao(
    { ...CESSAO, origemId: 'chave-nf-2', empresaId: 'sacado-2', gestaoOperacao: 'passivo' },
    TITULARES,
    PARAMS,
  )
  const vendAtiva = ativa.find((l) => l.papel === 'VENDEDOR')!
  const vendPassiva = passiva.find((l) => l.papel === 'VENDEDOR')!
  assert.equal(vendAtiva.taxa_brl_por_mm, 1000)
  assert.equal(vendPassiva.taxa_brl_por_mm, 400)
  // O originador é o mesmo cedente, e a taxa dele coincide nos dois modos — mas cada
  // lançamento carrega a classificação do sacado daquela cessão, não uma média.
  assert.equal(ativa.find((l) => l.papel === 'ORIGINADOR')!.gestao_operacao, 'prospeccao_ativa')
  assert.equal(passiva.find((l) => l.papel === 'ORIGINADOR')!.gestao_operacao, 'passivo')
})

test('conta sem classificação não gera lançamento nenhum', () => {
  assert.deepEqual(lancamentosDaCessao({ ...CESSAO, gestaoOperacao: null }, TITULARES, PARAMS), [])
})

test('split: dois titulares somando 100 dividem o valor, sem criar dinheiro', () => {
  const ls = lancamentosDaCessao(
    CESSAO,
    {
      vendedor: [
        { vendedorId: 'a', sharePct: 60, isIa: false },
        { vendedorId: 'b', sharePct: 40, isIa: false },
      ],
      originador: [],
    },
    PARAMS,
  )
  assert.equal(ls.length, 2)
  assert.equal(ls[0]!.valor + ls[1]!.valor, 750)
})

test('sunset do originador, quando publicado, corta a parcela dele', () => {
  const comSunset = [
    ...PARAMS,
    param({ chave: 'sunset_originador_meses', valor: 12, unidade: 'MONTHS' }),
  ]
  const antiga = { ...CESSAO, marcoAtivacao: '2023-01-01' }
  assert.deepEqual(lancamentosDaCessao(antiga, TITULARES, comSunset), [])
})

// ─── SDR ────────────────────────────────────────────────────────────────────

test('reunião aceita gera lançamento fixo; expirar como aceita gera o mesmo valor', () => {
  const base = {
    aceiteId: 'ac-1',
    sdrId: 'sdr-1',
    sdrIsIa: false,
    empresaId: 'sacado-1',
    empresaNome: 'Construtora Alfa',
    aceitaEm: '2026-03-05T12:00:00Z',
  }
  const explicito = lancamentoSdrReuniao({ ...base, automatico: false }, PARAMS)!
  const porPrazo = lancamentoSdrReuniao({ ...base, automatico: true }, PARAMS)!
  assert.equal(explicito.valor, 200)
  assert.equal(porPrazo.valor, 200)
  assert.match(porPrazo.descricao, /decurso de prazo/)
  assert.equal(explicito.competencia, '2026-03-01')
})

test('conta fechada dentro da janela paga; fora da janela, não', () => {
  const base = {
    aceiteId: 'ac-1',
    sdrId: 'sdr-1',
    sdrIsIa: false,
    empresaId: 'sacado-1',
    empresaNome: 'Construtora Alfa',
    reuniaoAceitaEm: '2026-01-10T12:00:00Z',
    origemIdCessao: 'chave-nf-1',
  }
  assert.equal(lancamentoSdrContaFechada({ ...base, fechadaEm: '2026-05-10T12:00:00Z' }, PARAMS)?.valor, 1500)
  assert.equal(lancamentoSdrContaFechada({ ...base, fechadaEm: '2026-09-10T12:00:00Z' }, PARAMS), null)
})

test('SDR de IA não recebe', () => {
  assert.equal(
    lancamentoSdrReuniao(
      {
        aceiteId: 'ac-1',
        sdrId: 'ia',
        sdrIsIa: true,
        empresaId: 'e',
        empresaNome: null,
        aceitaEm: '2026-03-05T12:00:00Z',
        automatico: false,
      },
      PARAMS,
    ),
    null,
  )
})

// ─── Estorno ────────────────────────────────────────────────────────────────

const ORIGINAIS: LancamentoOriginal[] = [
  {
    vendedor_id: 'vend-1',
    papel: 'VENDEDOR',
    origem_id: 'chave-nf-1',
    origem_tipo: 'nf_convertida',
    valor: 750,
    empresa_id: 'sacado-1',
    cedente_cnpj: '11111111000191',
    cedente_nome: 'Fornecedor Beta',
    nf_numero: '9001',
    descricao: 'NF 9001 — Construtora Alfa',
    competencia: '2026-03-01',
  },
  {
    vendedor_id: 'orig-1',
    papel: 'ORIGINADOR',
    origem_id: 'chave-nf-1',
    origem_tipo: 'nf_convertida',
    valor: 450,
    empresa_id: 'sacado-1',
    cedente_cnpj: '11111111000191',
    cedente_nome: 'Fornecedor Beta',
    nf_numero: '9001',
    descricao: 'NF 9001 — Fornecedor Beta',
    competencia: '2026-03-01',
  },
]

test('o estorno espelha 100% em TODOS os papéis da cessão', () => {
  const es = estornosDaCessao(ORIGINAIS, '2026-05-02T10:00:00Z', 'status regrediu')
  assert.equal(es.length, 2)
  assert.equal(es[0]!.valor, -750)
  assert.equal(es[1]!.valor, -450)
})

test('a competência do estorno é a CORRENTE, nunca a do original', () => {
  const es = estornosDaCessao(ORIGINAIS, '2026-05-02T10:00:00Z', 'NF cancelada')
  assert.equal(es[0]!.competencia, '2026-05-01')
  assert.equal(es[0]!.params_snapshot.competencia_original, '2026-03-01')
})

test('§8 — estorno parcial devolve a proporção, não o valor cheio', () => {
  const es = estornosDaCessao(ORIGINAIS, '2026-05-02T10:00:00Z', 'conversão parcial', 0.4)
  assert.equal(es[0]!.valor, -300)
  assert.equal(es[1]!.valor, -180)
})

test('estorno de proporção zero não gera linha', () => {
  assert.deepEqual(estornosDaCessao(ORIGINAIS, '2026-05-02T10:00:00Z', 'nada', 0), [])
})

// ─── Competência e fuso ─────────────────────────────────────────────────────

test('a competência é a de SÃO PAULO: 31/08 às 23h30 não vira setembro', () => {
  assert.equal(diaSp('2026-09-01T02:30:00Z'), '2026-08-31')
  assert.equal(competenciaSp('2026-09-01T02:30:00Z'), '2026-08-01')
  assert.equal(competenciaSp('2026-09-01T12:00:00Z'), '2026-09-01')
})

test('data sem hora não é deslocada', () => {
  assert.equal(diaSp('2026-03-01'), '2026-03-01')
})

// ─── Explicação e simulador ─────────────────────────────────────────────────

test('a explicação por extenso reproduz o exemplo do prompt', () => {
  const l = lancamentosDaCessao(CESSAO, TITULARES, PARAMS).find((x) => x.papel === 'ORIGINADOR')!
  const texto = explicarCalculo({ ...l, origem_tipo: 'nf_convertida' })
  assert.match(texto, /45\/30/)
  assert.match(texto, /750\.000 VOP/)
  assert.match(texto, /0,75/)
})

test('o simulador usa o mesmo motor: mesma entrada, mesmo número', () => {
  const r = simularComissao(
    { volume: 500_000, dias: 45, gestaoOperacao: 'prospeccao_ativa', idadeMeses: 2 },
    PARAMS,
    '2026-03-10',
  )
  assert.equal(r.vop, 750_000)
  assert.equal(r.fase, 'CRESCIMENTO')
  assert.equal(r.total, 1200)
  // R$ 1.200 sobre 750.000 de VOP = R$ 1.600 por milhão.
  assert.equal(r.custoPorMm, 1600)
})

test('o simulador em residual mostra o vendedor zerado, não a linha sumida', () => {
  const r = simularComissao(
    { volume: 1_000_000, dias: 30, gestaoOperacao: 'passivo', idadeMeses: 30 },
    PARAMS,
    '2026-03-10',
  )
  assert.equal(r.fase, 'RESIDUAL')
  assert.equal(r.linhas.find((l) => l.papel === 'VENDEDOR')!.valor, 0)
  assert.equal(r.linhas.find((l) => l.papel === 'ORIGINADOR')!.valor, 600)
})

// ─── Alerta de revisão ──────────────────────────────────────────────────────

test('o alerta só olha conta passiva, e só quando há base de comparação', () => {
  assert.equal(
    sugereRevisao({ gestaoOperacao: 'passivo', volumeJanela: 100, mediaMensalAnterior: 1000, percentualPiso: 50 }),
    true,
  )
  assert.equal(
    sugereRevisao({ gestaoOperacao: 'passivo', volumeJanela: 900, mediaMensalAnterior: 1000, percentualPiso: 50 }),
    false,
  )
  assert.equal(
    sugereRevisao({ gestaoOperacao: 'prospeccao_ativa', volumeJanela: 0, mediaMensalAnterior: 1000, percentualPiso: 50 }),
    false,
  )
  // Conta nova, sem histórico: silêncio é melhor que um alerta que sempre dispara.
  assert.equal(
    sugereRevisao({ gestaoOperacao: 'passivo', volumeJanela: 0, mediaMensalAnterior: 0, percentualPiso: 50 }),
    false,
  )
})

// ─── Deriva entre a folha e a régua de hoje ─────────────────────────────────

const lanc = (
  papel: 'VENDEDOR' | 'ORIGINADOR' | 'SDR',
  origem: string,
  vendedor: string,
  valor: number,
  empresa: string | null = 'conta-1',
  nome: string | null = 'Alfa',
) => ({ papel, origem_id: origem, vendedor_id: vendedor, valor, empresa_id: empresa, conta_nome: nome })

test('mesma taxa nos dois lados não vira diferença — nem por centavo de ponto flutuante', () => {
  // 750 + 0.1 + 0.2 dá 750.30000000000007, não 750.3. Sem fechar centavos antes de
  // comparar, esta linha apareceria como "alterada" e a tela mostraria uma diferença
  // que ninguém provocou.
  const atuais = [lanc('VENDEDOR', 'antecipacao:1', 'v1', 750 + 0.1 + 0.2)]
  const novos = [lanc('VENDEDOR', 'antecipacao:1', 'v1', 750.3)]
  const r = compararLancamentos(atuais, novos)
  assert.deepEqual(r.diferencas, [])
  assert.equal(r.delta, 0)
})

test('taxa que subiu vira uma linha `alterado` com o delta fechado', () => {
  const r = compararLancamentos(
    [lanc('VENDEDOR', 'antecipacao:1', 'v1', 500)],
    [lanc('VENDEDOR', 'antecipacao:1', 'v1', 750)],
  )
  assert.equal(r.diferencas.length, 1)
  assert.equal(r.diferencas[0]!.tipo, 'alterado')
  assert.equal(r.diferencas[0]!.delta, 250)
  assert.equal(r.total_atual, 500)
  assert.equal(r.total_novo, 750)
  assert.equal(r.delta, 250)
})

test('lançamento que a régua de hoje NÃO geraria aparece como removido', () => {
  // O caso mais perigoso: some se a comparação for feita só sobre as chaves da folha.
  const r = compararLancamentos([lanc('VENDEDOR', 'antecipacao:1', 'v1', 500)], [])
  assert.equal(r.diferencas.length, 1)
  assert.equal(r.diferencas[0]!.tipo, 'removido')
  assert.equal(r.diferencas[0]!.valor_novo, null)
  assert.equal(r.diferencas[0]!.delta, -500)
})

test('lançamento que a régua paga e a folha não aparece como novo', () => {
  const r = compararLancamentos([], [lanc('ORIGINADOR', 'antecipacao:9', 'v2', 300)])
  assert.equal(r.diferencas[0]!.tipo, 'novo')
  assert.equal(r.diferencas[0]!.valor_atual, null)
  assert.equal(r.diferencas[0]!.delta, 300)
})

test('a chave é papel + cessão + vendedor: dois papéis na mesma cessão não se confundem', () => {
  const r = compararLancamentos(
    [lanc('VENDEDOR', 'antecipacao:1', 'v1', 500), lanc('ORIGINADOR', 'antecipacao:1', 'v2', 300)],
    [lanc('VENDEDOR', 'antecipacao:1', 'v1', 600), lanc('ORIGINADOR', 'antecipacao:1', 'v2', 300)],
  )
  assert.equal(r.diferencas.length, 1)
  assert.equal(r.diferencas[0]!.papel, 'VENDEDOR')
})

test('as diferenças saem ordenadas pelo que mais mexe no bolso', () => {
  const r = compararLancamentos(
    [
      lanc('VENDEDOR', 'antecipacao:1', 'v1', 100),
      lanc('VENDEDOR', 'antecipacao:2', 'v1', 100),
      lanc('VENDEDOR', 'antecipacao:3', 'v1', 100),
    ],
    [
      lanc('VENDEDOR', 'antecipacao:1', 'v1', 110),
      lanc('VENDEDOR', 'antecipacao:2', 'v1', 900),
      lanc('VENDEDOR', 'antecipacao:3', 'v1', 50),
    ],
  )
  assert.deepEqual(
    r.diferencas.map((d) => d.origem_id),
    ['antecipacao:2', 'antecipacao:3', 'antecipacao:1'],
  )
})

test('a deriva é agrupada por conta, que é a unidade que o recálculo sabe tratar', () => {
  const contas = agruparDerivaPorConta(
    compararLancamentos(
      [
        lanc('VENDEDOR', 'antecipacao:1', 'v1', 100, 'conta-a', 'Alfa'),
        lanc('ORIGINADOR', 'antecipacao:1', 'v2', 100, 'conta-a', 'Alfa'),
        lanc('VENDEDOR', 'antecipacao:5', 'v1', 100, 'conta-b', 'Beta'),
      ],
      [
        lanc('VENDEDOR', 'antecipacao:1', 'v1', 150, 'conta-a', 'Alfa'),
        lanc('ORIGINADOR', 'antecipacao:1', 'v2', 130, 'conta-a', 'Alfa'),
        lanc('VENDEDOR', 'antecipacao:5', 'v1', 90, 'conta-b', 'Beta'),
      ],
    ).diferencas,
  )
  assert.equal(contas.length, 2)
  // Alfa primeiro: +80 contra −10.
  assert.equal(contas[0]!.empresa_id, 'conta-a')
  assert.equal(contas[0]!.lancamentos, 2)
  assert.equal(contas[0]!.delta, 80)
  assert.equal(contas[1]!.empresa_id, 'conta-b')
  assert.equal(contas[1]!.delta, -10)
})

test('cessão sem conta resolvida fica fora do agrupamento — não há o que recalcular', () => {
  const contas = agruparDerivaPorConta(
    compararLancamentos(
      [lanc('VENDEDOR', 'antecipacao:7', 'v1', 100, null, null)],
      [lanc('VENDEDOR', 'antecipacao:7', 'v1', 200, null, null)],
    ).diferencas,
  )
  assert.deepEqual(contas, [])
})
