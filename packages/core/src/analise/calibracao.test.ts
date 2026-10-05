import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calibrarItem, curvaPrecisaoRecall, deveRecalibrar, rubricaCalibrada, type Amostra } from './calibracao.ts'

const CFG = { min_amostras: 20, min_por_classe: 3, f1_minimo: 0.7 }

/** Um Jev subconfiante e bom: acertos em ~0,75, faltas em ~0,3. */
function separavel(): Amostra[] {
  const atendidos = Array.from({ length: 14 }, (_, i) => ({ prob_atendido: 0.7 + (i % 4) * 0.02, atendido: true }))
  const faltas = Array.from({ length: 6 }, (_, i) => ({ prob_atendido: 0.25 + i * 0.03, atendido: false }))
  return [...atendidos, ...faltas]
}

test('amostras insuficientes: inativo, sem limiar chutado', () => {
  const r = calibrarItem(separavel().slice(0, 12), CFG)
  assert.equal(r.status, 'inativo_amostras')
  assert.equal(r.limiar, null)
  assert.match(r.motivo, /12 de 20/)
})

test('sem faltas rotuladas não há o que medir: inativo, mesmo com 30 amostras', () => {
  const r = calibrarItem(Array.from({ length: 30 }, () => ({ prob_atendido: 0.8, atendido: true })), CFG)
  assert.equal(r.status, 'inativo_amostras')
  assert.match(r.motivo, /0 falta/)
})

test('separável: limiar entre as duas nuvens, F1 = 1, publicado — e abaixo de 0,9', () => {
  const r = calibrarItem(separavel(), CFG)
  assert.equal(r.status, 'publicado')
  assert.equal(r.f1, 1)
  assert.ok(r.limiar! > 0.4 && r.limiar! <= 0.7, `limiar ${r.limiar}`)
  // em empate, o MENOR limiar que maximiza: o que reprova menos
  assert.equal(r.limiar, 0.41)
})

test('item que não separa nada fica em sombra como pergunta mal formulada', () => {
  // O classificador dá a mesma probabilidade para todos: não distingue nada.
  const cego: Amostra[] = Array.from({ length: 24 }, (_, i) => ({ prob_atendido: 0.6, atendido: i % 3 !== 0 }))
  const r = calibrarItem(cego, CFG)
  assert.equal(r.status, 'sombra_f1')
  assert.match(r.motivo, /reescrita/)
})

test('F1 acima do mínimo só por prevalência alta de falta não publica', () => {
  // 70% das amostras são falta: apontar falta em tudo dá F1 0,82, acima do mínimo de 0,70.
  const cego: Amostra[] = Array.from({ length: 20 }, (_, i) => ({ prob_atendido: 0.6, atendido: i < 6 }))
  const r = calibrarItem(cego, CFG)
  assert.ok(r.f1! >= 0.7)
  assert.equal(r.status, 'sombra_f1')
  assert.match(r.motivo, /não supera apontar falta em todas/)
})

test('F1 que supera a régua trivial mas fica abaixo do mínimo: sombra', () => {
  // poucas faltas, separação parcial
  const amostras: Amostra[] = [
    ...Array.from({ length: 14 }, (_, i) => ({ prob_atendido: 0.3 + (i % 7) * 0.08, atendido: true })),
    ...Array.from({ length: 6 }, (_, i) => ({ prob_atendido: 0.3 + i * 0.1, atendido: false })),
  ]
  const r = calibrarItem(amostras, CFG)
  assert.equal(r.status, 'sombra_f1')
  assert.ok(r.f1! < 0.7)
})

test('a curva mostra precisão, recall e quantas faltas cada limiar aponta', () => {
  const c = curvaPrecisaoRecall(separavel())
  assert.equal(c.length, 99)
  const p50 = c.find((p) => p.limiar === 0.5)!
  assert.equal(p50.apontadas, 6)
  assert.equal(p50.precisao, 1)
  assert.equal(p50.recall, 1)
  const p90 = c.find((p) => p.limiar === 0.9)!
  // limiar alto por intuição: aponta todos os acertos subconfiantes como falta
  assert.equal(p90.apontadas, 20)
  assert.equal(p90.precisao, 0.3)
})

test('rubrica sai de sombra se pelo menos um item publicou', () => {
  const ok = calibrarItem(separavel(), CFG)
  const inativo = calibrarItem([], CFG)
  assert.equal(rubricaCalibrada([inativo]), false)
  assert.equal(rubricaCalibrada([inativo, ok]), true)
})

test('recalibra quando nunca calibrou ou quando chegam N contestações', () => {
  assert.equal(deveRecalibrar({ calibrada_em: null, contestacoes_desde: 0, limite: 15 }), true)
  assert.equal(deveRecalibrar({ calibrada_em: '2026-10-01', contestacoes_desde: 14, limite: 15 }), false)
  assert.equal(deveRecalibrar({ calibrada_em: '2026-10-01', contestacoes_desde: 15, limite: 15 }), true)
})
