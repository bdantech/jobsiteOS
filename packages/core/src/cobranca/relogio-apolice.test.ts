import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ehDiaUtil, somarDiasCorridos, somarDiasUteis, somarMeses } from './datas.ts'
import {
  alertasDoDia,
  calcularPrazosApolice,
  escolherApolice,
  prazosPerdidos,
  restabelecimentoCobertura,
  type ApoliceRelogio,
  type EstadoPrazo,
} from './relogio-apolice.ts'

const APOLICE_2026: ApoliceRelogio = {
  id: 'ap-2026',
  vigencia_inicio: '2026-06-01',
  vigencia_fim: '2027-05-31',
  ativa: true,
  periodo_espera_dias: 180,
  periodo_max_prorrogacao_dias: 60,
  prazo_notificacao_apos_prorrogacao_dias: 30,
  prazo_envio_sinistro_meses: 6,
}

const CFG = {
  parada_cobertura: 45,
  notificacao_seguradora: 75,
  notificacao_critica: 85,
  data_perda: 150,
  envio_sinistro: [300, 345],
}

const estado = (vencimento: string, extra: Partial<EstadoPrazo> = {}): EstadoPrazo => ({
  ...calcularPrazosApolice({ vencimento_original: vencimento, apolice: APOLICE_2026 }),
  notificado_seguradora_em: null,
  sinistro_enviado: false,
  alertas_emitidos: {},
  ...extra,
})

test('os quatro marcos saem da apólice: D+60, D+90, D+180 e Data da Perda + 6 meses', () => {
  const p = calcularPrazosApolice({ vencimento_original: '2026-07-10', apolice: APOLICE_2026 })
  assert.equal(p.causa, 'mora_prolongada')
  assert.equal(p.data_parada_cobertura, '2026-09-08')
  assert.equal(p.data_limite_notificacao, '2026-10-08')
  assert.equal(p.data_perda, '2027-01-06')
  assert.equal(p.data_limite_sinistro, '2027-07-06')
})

test('vencimento em fim de semana: o relógio conta do sábado, em dias corridos', () => {
  assert.equal(ehDiaUtil('2026-08-01'), false) // sábado
  const p = calcularPrazosApolice({ vencimento_original: '2026-08-01', apolice: APOLICE_2026 })
  assert.equal(p.data_parada_cobertura, somarDiasCorridos('2026-08-01', 60))
  assert.equal(p.data_limite_notificacao, somarDiasCorridos('2026-08-01', 90))
})

test('título pago em D+85: dentro dos 30 dias após D+60, cobertura retroativa', () => {
  const p = calcularPrazosApolice({ vencimento_original: '2026-07-10', apolice: APOLICE_2026 })
  const r = restabelecimentoCobertura({
    pago_em: somarDiasCorridos('2026-07-10', 85),
    data_parada_cobertura: p.data_parada_cobertura,
  })
  assert.equal(r.interrompida, true)
  assert.equal(r.retroativo, true)
  assert.equal(r.cobertura_volta_em, p.data_parada_cobertura)
})

test('título pago em D+95: fora da janela, cobertura só para o cedido após o pagamento', () => {
  const p = calcularPrazosApolice({ vencimento_original: '2026-07-10', apolice: APOLICE_2026 })
  const pago = somarDiasCorridos('2026-07-10', 95)
  const r = restabelecimentoCobertura({ pago_em: pago, data_parada_cobertura: p.data_parada_cobertura })
  assert.equal(r.retroativo, false)
  assert.equal(r.cobertura_volta_em, pago)
})

test('sacado posto em cobrança: não há retroatividade mesmo pago dentro da janela (cl. 17700.20 b)', () => {
  const p = calcularPrazosApolice({ vencimento_original: '2026-07-10', apolice: APOLICE_2026 })
  const pago = somarDiasCorridos('2026-07-10', 70)
  const r = restabelecimentoCobertura({
    pago_em: pago,
    data_parada_cobertura: p.data_parada_cobertura,
    em_cobranca_desde: somarDiasCorridos('2026-07-10', 20),
  })
  assert.equal(r.retroativo, false)
  assert.equal(r.cobertura_volta_em, pago)
})

test('pago antes de D+60: a cobertura nem chegou a parar', () => {
  const r = restabelecimentoCobertura({ pago_em: '2026-08-01', data_parada_cobertura: '2026-09-08' })
  assert.equal(r.interrompida, false)
  assert.equal(r.cobertura_volta_em, null)
})

test('mudança de causa de mora para insolvência no meio: a Data da Perda vira a decisão', () => {
  const venc = '2026-07-10'
  const mora = calcularPrazosApolice({ vencimento_original: venc, apolice: APOLICE_2026 })
  const insolv = calcularPrazosApolice({
    vencimento_original: venc,
    apolice: APOLICE_2026,
    insolvencia_data_decisao: '2026-08-31',
  })
  assert.equal(insolv.causa, 'insolvencia')
  // os marcos de cobertura e de notificação não mudam
  assert.equal(insolv.data_parada_cobertura, mora.data_parada_cobertura)
  assert.equal(insolv.data_limite_notificacao, mora.data_limite_notificacao)
  assert.equal(insolv.data_perda, '2026-08-31')
  // 31/08 + 6 meses = 28/02, nunca 03/03
  assert.equal(insolv.data_limite_sinistro, '2027-02-28')
  assert.ok(insolv.data_limite_sinistro < mora.data_limite_sinistro, 'o caminho da insolvência é mais curto')
})

test('insolvência decidida tarde não empurra o prazo além do da mora', () => {
  const venc = '2026-07-10'
  const mora = calcularPrazosApolice({ vencimento_original: venc, apolice: APOLICE_2026 })
  const insolv = calcularPrazosApolice({
    vencimento_original: venc,
    apolice: APOLICE_2026,
    insolvencia_data_decisao: '2027-03-01',
  })
  assert.equal(insolv.data_limite_sinistro, mora.data_limite_sinistro)
})

test('apólice renovada com parâmetros diferentes no meio da contagem: rege a do vencimento', () => {
  const renovada: ApoliceRelogio = {
    ...APOLICE_2026,
    id: 'ap-2027',
    vigencia_inicio: '2027-06-01',
    vigencia_fim: '2028-05-31',
    periodo_max_prorrogacao_dias: 90,
    periodo_espera_dias: 150,
  }
  const apolices = [APOLICE_2026, renovada]
  // vencido em abril/2027, sob a de 2026; a contagem atravessa a renovação
  const escolhida = escolherApolice(apolices, '2027-04-20')
  assert.equal(escolhida?.id, 'ap-2026')
  const p = calcularPrazosApolice({ vencimento_original: '2027-04-20', apolice: escolhida! })
  assert.equal(p.data_parada_cobertura, somarDiasCorridos('2027-04-20', 60))
  // vencido depois da renovação: rege a nova, com a régua nova
  const nova = escolherApolice(apolices, '2027-07-01')
  assert.equal(nova?.id, 'ap-2027')
  assert.equal(
    calcularPrazosApolice({ vencimento_original: '2027-07-01', apolice: nova! }).data_parada_cobertura,
    somarDiasCorridos('2027-07-01', 90),
  )
})

test('alertas: D+45 aviso de parada, D+75 notificação, D+85 crítico diário', () => {
  const venc = '2026-07-10'
  const d = (n: number) => somarDiasCorridos(venc, n)

  const a45 = alertasDoDia(estado(venc), d(45), CFG)
  assert.deepEqual(a45.map((a) => a.chave), ['parada_cobertura'])
  assert.equal(a45[0]!.dias_restantes, 15)

  const a75 = alertasDoDia(estado(venc, { alertas_emitidos: { parada_cobertura: d(45) } }), d(75), CFG)
  assert.deepEqual(a75.map((a) => a.chave), ['notificacao_seguradora'])

  const emitidos = { parada_cobertura: d(45), notificacao_seguradora: d(75) }
  const a85 = alertasDoDia(estado(venc, { alertas_emitidos: emitidos }), d(85), CFG)
  assert.deepEqual(a85.map((a) => [a.chave, a.nivel]), [['notificacao_critica', 'critico']])

  // no dia seguinte repete, porque ainda não foi resolvido
  const a86 = alertasDoDia(
    estado(venc, { alertas_emitidos: { ...emitidos, notificacao_critica: d(85) } }),
    d(86),
    CFG,
  )
  assert.deepEqual(a86.map((a) => a.chave), ['notificacao_critica'])

  // notificada a seguradora, o crítico para
  const resolvido = alertasDoDia(
    estado(venc, { notificado_seguradora_em: d(86), alertas_emitidos: { ...emitidos, notificacao_critica: d(86) } }),
    d(87),
    CFG,
  )
  assert.equal(resolvido.length, 0)
})

test('alerta que o job perdeu num dia sai no dia seguinte, uma vez só', () => {
  const venc = '2026-07-10'
  const a = alertasDoDia(estado(venc), somarDiasCorridos(venc, 47), CFG)
  assert.deepEqual(a.map((x) => x.chave), ['parada_cobertura'])
  const b = alertasDoDia(estado(venc, { alertas_emitidos: { parada_cobertura: 'x' } }), somarDiasCorridos(venc, 48), CFG)
  assert.equal(b.length, 0)
})

test('D+150 avisa a Data da Perda; D+300 e D+345 avisam o envio do sinistro', () => {
  const venc = '2026-07-10'
  const p = estado(venc, { notificado_seguradora_em: somarDiasCorridos(venc, 80) })
  assert.deepEqual(alertasDoDia(p, somarDiasCorridos(venc, 150), CFG).map((a) => a.chave), ['data_perda'])
  const limite = p.data_limite_sinistro
  assert.deepEqual(alertasDoDia(p, somarDiasCorridos(limite, -60), CFG).map((a) => a.chave), ['envio_sinistro:60'])
  const p2 = { ...p, alertas_emitidos: { 'envio_sinistro:60': 'x' } }
  assert.deepEqual(alertasDoDia(p2, somarDiasCorridos(limite, -15), CFG).map((a) => a.chave), ['envio_sinistro:15'])
})

test('prazo perdido: D+91 sem notificação à seguradora', () => {
  const venc = '2026-07-10'
  const perdidos = prazosPerdidos(estado(venc), somarDiasCorridos(venc, 91))
  assert.deepEqual(perdidos.map((p) => p.marco), ['notificacao_seguradora'])
  assert.equal(prazosPerdidos(estado(venc, { notificado_seguradora_em: '2026-09-30' }), somarDiasCorridos(venc, 91)).length, 0)
})

test('dias úteis pulam fim de semana e feriado bancário', () => {
  // sexta 04/09/2026 + 5 úteis: 07/09 é feriado → 08, 09, 10, 11, 14
  assert.equal(somarDiasUteis('2026-09-04', 5), '2026-09-14')
  assert.equal(somarMeses('2026-01-31', 1), '2026-02-28')
})
