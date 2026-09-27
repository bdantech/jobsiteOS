import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONFIG_AGENTES_PADRAO } from './schemas.ts'
import { aplicarTrancas, type FatosDaTranca } from './trancas.ts'

// 2026-09-29 é uma terça-feira; 13h UTC = 10h em São Paulo, dentro da janela 9h–18h.
const TERCA_10H = new Date('2026-09-29T13:00:00Z')

function fatos(extra: Partial<FatosDaTranca> = {}, mandato: Partial<FatosDaTranca['mandato']> = {}): FatosDaTranca {
  return {
    agora: TERCA_10H,
    killSwitch: false,
    agentePausado: false,
    disjuntor: 'ok',
    saldoGlobalCentavos: 100_000,
    mandato: {
      gastoCentavos: 0,
      orcamentoCentavos: 2_000,
      acoesExecutadas: 0,
      maxAcoes: 20,
      expiraEm: new Date('2026-10-20T00:00:00Z'),
      acoesHoje: 0,
      ...mandato,
    },
    acoesPorMandatoPorDia: 4,
    cotaDiariaRestante: 100,
    empresaSuprimida: false,
    empresaEmCobranca: false,
    janela: CONFIG_AGENTES_PADRAO.janela,
    custoMinimoCicloCentavos: 5,
    ...extra,
  }
}

test('sem nada travando, o mandato passa', () => {
  assert.deepEqual(aplicarTrancas(fatos()), { passa: true })
})

test('cada tranca, isolada, dá o efeito certo', () => {
  const casos: Array<[FatosDaTranca, string, string]> = [
    [fatos({ killSwitch: true }), 'kill_switch', 'pular'],
    [fatos({ agentePausado: true }), 'agente_pausado', 'pular'],
    [fatos({ disjuntor: 'aberto' }), 'disjuntor_aberto', 'pausar'],
    [fatos({ saldoGlobalCentavos: 0 }), 'orcamento_global', 'pausar'],
    [fatos({}, { gastoCentavos: 2_000 }), 'orcamento_mandato', 'encerrar'],
    [fatos({ cotaDiariaRestante: 0 }), 'cota_diaria_agente', 'reagendar'],
    [fatos({}, { acoesHoje: 4 }), 'acoes_do_dia', 'reagendar'],
    [fatos({}, { acoesExecutadas: 20 }), 'max_acoes', 'encerrar'],
    [fatos({}, { expiraEm: new Date('2026-09-28T00:00:00Z') }), 'expirado', 'encerrar'],
    [fatos({ empresaSuprimida: true }), 'suprimido', 'encerrar'],
    [fatos({ empresaEmCobranca: true }), 'em_cobranca', 'encerrar'],
    [fatos({ agora: new Date('2026-09-29T23:00:00Z') }), 'fora_da_janela', 'reagendar'],
  ]
  for (const [f, tranca, efeito] of casos) {
    const v = aplicarTrancas(f)
    assert.equal(v.passa, false, tranca)
    if (!v.passa) {
      assert.equal(v.tranca, tranca)
      assert.equal(v.efeito, efeito, tranca)
    }
  }
})

test('duas trancas ao mesmo tempo: vale a primeira da ordem (a mais ampla)', () => {
  // Disjuntor aberto E empresa em cobrança: o que se registra é o disjuntor, porque é ele
  // que para o AGENTE inteiro — a cobrança seria a razão de um mandato só.
  const v = aplicarTrancas(fatos({ disjuntor: 'aberto', empresaEmCobranca: true }))
  assert.equal(v.passa, false)
  if (!v.passa) assert.equal(v.tranca, 'disjuntor_aberto')

  // Orçamento global E prazo vencido: pausa (a casa), não encerra (o mandato).
  const w = aplicarTrancas(fatos({ saldoGlobalCentavos: 0 }, { expiraEm: new Date('2026-09-01T00:00:00Z') }))
  if (!w.passa) {
    assert.equal(w.tranca, 'orcamento_global')
    assert.equal(w.efeito, 'pausar')
  }
})

test('fora da janela REAGENDA para a abertura, em vez de encerrar', () => {
  const v = aplicarTrancas(fatos({ agora: new Date('2026-09-29T23:00:00Z') })) // 20h em SP
  assert.equal(v.passa, false)
  if (!v.passa && v.efeito === 'reagendar') {
    // Próxima abertura: quarta 30/09 às 9h de São Paulo = 12h UTC.
    assert.equal(v.quando.toISOString(), '2026-09-30T12:00:00.000Z')
  } else {
    assert.fail('esperava reagendar')
  }
})

test('orçamento global esgotado pausa com o motivo que o mês seguinte desfaz', () => {
  const v = aplicarTrancas(fatos({ saldoGlobalCentavos: 3 }))
  assert.deepEqual(v, { passa: false, tranca: 'orcamento_global', efeito: 'pausar', motivo: 'orcamento_esgotado' })
})
