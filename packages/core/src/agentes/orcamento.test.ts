import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LivroOrcamento,
  alertasCruzados,
  custoTokensCentavos,
  percentualConsumido,
  saldoGlobal,
} from './orcamento.ts'
import { CONFIG_AGENTES_PADRAO } from './schemas.ts'

test('dois mandatos concorrendo pelo mesmo saldo: o segundo é recusado, nunca os dois passam', () => {
  const livro = new LivroOrcamento(500) // R$ 5,00 no mês
  livro.definirMandato('m1', 10_000)
  livro.definirMandato('m2', 10_000)

  // Os dois pedem R$ 3,50 (uma ligação) "ao mesmo tempo" — em sequência na seção crítica.
  const a = livro.reservar({ mandatoId: 'm1', agenteId: 'ana', valor: 350 })
  const b = livro.reservar({ mandatoId: 'm2', agenteId: 'bia', valor: 350 })
  assert.equal(a.ok, true)
  assert.deepEqual(b, { ok: false, motivo: 'orcamento_global', saldoCentavos: 150 })
  // A reserva conta como gasto enquanto está aberta: é exatamente o que impede o segundo.
  assert.equal(livro.estado.reservado, 350)
})

test('teto do mandato: um mandato em laço não drena a pool', () => {
  const livro = new LivroOrcamento(100_000)
  livro.definirMandato('laco', 700)
  assert.equal(livro.reservar({ mandatoId: 'laco', agenteId: 'ana', valor: 350 }).ok, true)
  assert.equal(livro.reservar({ mandatoId: 'laco', agenteId: 'ana', valor: 350 }).ok, true)
  const terceira = livro.reservar({ mandatoId: 'laco', agenteId: 'ana', valor: 350 })
  assert.deepEqual(terceira, { ok: false, motivo: 'orcamento_mandato', saldoCentavos: 0 })
  // A pool global continua quase inteira para os outros mandatos.
  assert.equal(livro.estado.saldo, 100_000 - 700)
})

test('custo real acima do estimado é aceito e aparece no consumo', () => {
  const livro = new LivroOrcamento(10_000)
  livro.definirMandato('m', 5_000)
  const r = livro.reservar({ mandatoId: 'm', agenteId: 'ana', valor: 200 })
  assert.ok(r.ok)
  livro.consumir(r.reservaId, 260)
  assert.equal(livro.estado.consumido, 260)
  assert.equal(livro.estado.reservado, 0)
  assert.equal(livro.gastoDoMandato('m'), 260)
})

test('custo real abaixo do estimado: a diferença volta ao saldo', () => {
  const livro = new LivroOrcamento(1_000)
  livro.definirMandato('m', 1_000)
  const r = livro.reservar({ mandatoId: 'm', agenteId: 'ana', valor: 350 })
  assert.ok(r.ok)
  livro.consumir(r.reservaId, 120)
  assert.equal(livro.estado.saldo, 880)
})

test('falha depois da reserva: estorno total, e estornar duas vezes não devolve em dobro', () => {
  const livro = new LivroOrcamento(1_000)
  livro.definirMandato('m', 1_000)
  const r = livro.reservar({ mandatoId: 'm', agenteId: 'ana', valor: 350 })
  assert.ok(r.ok)
  livro.estornar(r.reservaId)
  livro.estornar(r.reservaId)
  assert.deepEqual(livro.estado, { teto: 1_000, consumido: 0, reservado: 0, saldo: 1_000 })
  // Consumir uma reserva já estornada não cobra nada.
  livro.consumir(r.reservaId, 350)
  assert.equal(livro.estado.consumido, 0)
})

test('teto diário do agente conta consumido + reservas abertas do dia', () => {
  const livro = new LivroOrcamento(100_000)
  livro.definirMandato('m1', 10_000)
  livro.definirMandato('m2', 10_000)
  livro.definirTetoDiario('ana', 500)
  const r = livro.reservar({ mandatoId: 'm1', agenteId: 'ana', valor: 350 })
  assert.ok(r.ok)
  livro.consumir(r.reservaId, 350)
  const segunda = livro.reservar({ mandatoId: 'm2', agenteId: 'ana', valor: 200 })
  assert.deepEqual(segunda, { ok: false, motivo: 'teto_diario_agente', saldoCentavos: 150 })
  // Outro dia, outro teto.
  assert.equal(livro.reservar({ mandatoId: 'm2', agenteId: 'ana', valor: 200, dia: 'amanha' }).ok, true)
})

test('tokens viram centavos pela tabela da config', () => {
  // 10k de entrada a US$3/MTok + 2k de saída a US$15/MTok = US$ 0,06 × 5,5 = R$ 0,33
  assert.equal(custoTokensCentavos({ entrada: 10_000, saida: 2_000 }, CONFIG_AGENTES_PADRAO.precos), 33)
  assert.equal(custoTokensCentavos({ entrada: 0, saida: 0 }, CONFIG_AGENTES_PADRAO.precos), 0)
})

test('saldo e alertas: 100% é sempre um limiar, e cada um sai uma vez', () => {
  assert.equal(saldoGlobal({ teto_centavos: 1000, consumido_centavos: 600, reservado_centavos: 300 }), 100)
  assert.equal(percentualConsumido({ teto_centavos: 1000, consumido_centavos: 820 }), 82)
  assert.deepEqual(alertasCruzados(82, [50, 80, 95], []), [50, 80])
  assert.deepEqual(alertasCruzados(82, [50, 80, 95], [50, 80]), [])
  assert.deepEqual(alertasCruzados(100, [50, 80, 95], [50, 80]), [95, 100])
})
