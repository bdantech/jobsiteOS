import assert from 'node:assert/strict'
import test from 'node:test'

import {
  composicaoPorChave,
  corPorEspera,
  squarify,
  tintaSobre,
  STATUS_CORES,
} from './meu-dia-visual.js'

// ─── Treemap ────────────────────────────────────────────────────────────────

/** A carteira real do Fabio: 29 clientes, de R$ 7 mi a zero. */
const CARTEIRA = [
  7_000_000, 3_700_000, 3_000_000, 3_000_000, 3_000_000, 2_500_000, 2_000_000, 1_500_000,
  1_085_594, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 750_000, 750_000,
  750_000, 750_000, 735_000, 600_000, 500_000, 500_000, 500_000, 500_000, 500_000, 500_000,
  150_000, 150_000, 0,
]

function medir(rets: ReturnType<typeof squarify>, W: number, H: number) {
  const area = rets.reduce((s, r) => s + r.w * r.h, 0)
  let fora = 0
  let sobrepoe = 0
  for (const r of rets) {
    if (r.x < -1e-6 || r.y < -1e-6 || r.x + r.w > W + 1e-6 || r.y + r.h > H + 1e-6) fora++
  }
  for (let i = 0; i < rets.length; i++) {
    for (let j = i + 1; j < rets.length; j++) {
      const a = rets[i]!
      const b = rets[j]!
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (ox > 1e-6 && oy > 1e-6) sobrepoe++
    }
  }
  const razoes = rets.filter((r) => r.w > 0 && r.h > 0).map((r) => Math.max(r.w / r.h, r.h / r.w))
  return { cobertura: area / (W * H), fora, sobrepoe, piorRazao: Math.max(...razoes, 0) }
}

test('o treemap cobre o componente inteiro, sem sobra e sem sobreposição', () => {
  // A promessa do formato é justamente esta: nenhum espaço morto para interpretar.
  for (const [W, H] of [
    [560, 240],
    [340, 240],
    [320, 180],
  ] as const) {
    const m = medir(squarify(CARTEIRA, W, H), W, H)
    assert.ok(Math.abs(m.cobertura - 1) < 1e-9, `cobertura ${m.cobertura} em ${W}x${H}`)
    assert.equal(m.fora, 0)
    assert.equal(m.sobrepoe, 0)
  }
})

test('nenhum retângulo vira tira fina — é para isso que o squarify existe', () => {
  // Uma tira de 4px de largura tem área correta e é ilegível. 3:1 é o teto tolerável.
  const m = medir(squarify(CARTEIRA, 560, 240), 560, 240)
  assert.ok(m.piorRazao < 3, `pior razão de aspecto ${m.piorRazao}`)
})

test('o cliente de limite zero continua no mapa', () => {
  // Área proporcional pura o apagaria, e sumir com um cliente é pior que distorcer 0,4%.
  const rets = squarify(CARTEIRA, 560, 240)
  assert.equal(rets.length, CARTEIRA.length)
  const ultimo = rets[rets.length - 1]!
  assert.ok(ultimo.w > 0 && ultimo.h > 0)
})

test('degenerados não quebram: vazio, um só, tudo zero, largura ainda não medida', () => {
  assert.deepEqual(squarify([], 100, 100), [])
  assert.equal(squarify([10], 100, 100).length, 1)
  assert.equal(medir(squarify([10], 100, 100), 100, 100).cobertura, 1)
  assert.equal(squarify([0, 0, 0], 100, 100).length, 3)
  // Antes do ResizeObserver medir, a largura é 0: devolve caixas vazias, não NaN.
  const semLargura = squarify(CARTEIRA, 0, 240)
  assert.equal(semLargura.length, CARTEIRA.length)
  assert.ok(semLargura.every((r) => r.w === 0 && r.h === 0))
})

test('a ordem decrescente é o que mantém os retângulos quadrados', () => {
  // Documenta o contrato: entrada crescente degrada o formato, e por isso quem chama ordena.
  const crescente = [...CARTEIRA].reverse()
  const bom = medir(squarify(CARTEIRA, 560, 240), 560, 240).piorRazao
  const ruim = medir(squarify(crescente, 560, 240), 560, 240).piorRazao
  assert.ok(ruim > bom)
})

// ─── Cor ────────────────────────────────────────────────────────────────────

test('a espera vai de azul a vermelho, e satura fora do intervalo', () => {
  assert.equal(corPorEspera(0), 'rgb(42, 120, 214)')
  assert.equal(corPorEspera(96), 'rgb(208, 59, 59)')
  assert.equal(corPorEspera(-10), corPorEspera(0))
  assert.equal(corPorEspera(500), corPorEspera(96))
  // No meio do caminho, no meio das duas cores.
  assert.equal(corPorEspera(48), 'rgb(125, 90, 137)')
})

test('a tinta sobre cada status é a legível, não a bonita', () => {
  // Branco sobre o amarelo de low_operation dá 1,7:1 — o teste existe para isso não voltar.
  assert.equal(tintaSobre(STATUS_CORES.low_operation!), '#0b0b0b')
  assert.equal(tintaSobre(STATUS_CORES.inoperative!), '#ffffff')
  assert.equal(tintaSobre('#ffffff'), '#0b0b0b')
  assert.equal(tintaSobre('#000000'), '#ffffff')
})

// ─── Composição ─────────────────────────────────────────────────────────────

const nf = (cedente: string, valor: number) => ({ meta: { cedente_nome: cedente }, titulo: 'x', valor })

test('a composição soma por chave e dobra a cauda em "Outros"', () => {
  const fatias = composicaoPorChave(
    [
      nf('A', 100), nf('A', 50), nf('B', 120), nf('C', 90), nf('D', 80),
      nf('E', 70), nf('F', 10), nf('G', 5),
    ],
    'cedente_nome',
  )
  assert.deepEqual(fatias.map((f) => f.nome), ['A', 'B', 'C', 'D', 'E', 'Outros'])
  // Doze notas do mesmo fornecedor são uma conversa, e não doze: A soma 150.
  assert.equal(fatias[0]!.valor, 150)
  assert.equal(fatias.at(-1)!.valor, 15)
})

test('sem cauda não existe fatia "Outros" vazia', () => {
  const fatias = composicaoPorChave([nf('A', 10), nf('B', 5)], 'cedente_nome')
  assert.deepEqual(fatias.map((f) => f.nome), ['A', 'B'])
})

test('item sem a chave cai no próprio título, e não num balde anônimo', () => {
  const fatias = composicaoPorChave([{ meta: {}, titulo: 'SEM CEDENTE', valor: 10 }], 'cedente_nome')
  assert.equal(fatias[0]!.nome, 'SEM CEDENTE')
})
