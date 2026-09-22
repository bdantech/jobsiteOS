import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  casarPedidosComCoberturas,
  houveReducaoDeLimite,
  type DecisaoSeguradora,
} from './seguradora.ts'

function cobertura(over: Partial<DecisaoSeguradora> & { case_id: string }): DecisaoSeguradora {
  return {
    buyer_id: '37845314',
    estagio: 'aprovada',
    limite_aprovado: 1_500_000,
    moeda: 'BRL',
    expira_em: null,
    decidida_em: '2026-09-21',
    motivo: null,
    rating: null,
    identificador_nacional: '25464260000149',
    ...over,
  }
}

// ─── Redução de limite ──────────────────────────────────────────────────────

test('só é redução quando havia limite e ele diminuiu', () => {
  assert.equal(houveReducaoDeLimite(1_000_000, 500_000), true)
  assert.equal(houveReducaoDeLimite(1_000_000, null), true)
  assert.equal(houveReducaoDeLimite(null, 500_000), false)
  assert.equal(houveReducaoDeLimite(500_000, 500_000), false)
  assert.equal(houveReducaoDeLimite(500_000, 900_000), false)
})

// ─── O casamento do pedido aberto por fora com a cobertura ──────────────────

test('um pedido aberto e uma cobertura livre do mesmo CNPJ viram vínculo', () => {
  const r = casarPedidosComCoberturas(
    [{ analise_id: 'a1', cnpj: '25464260000149' }],
    [cobertura({ case_id: '143912539' })],
    [],
  )
  assert.equal(r.ambiguos.length, 0)
  assert.deepEqual(
    r.vinculos.map((v) => [v.analise_id, v.cobertura.case_id]),
    [['a1', '143912539']],
  )
})

test('o CNPJ vem mascarado e casa do mesmo jeito', () => {
  const r = casarPedidosComCoberturas(
    [{ analise_id: 'a1', cnpj: '25.464.260/0001-49' }],
    [cobertura({ case_id: 'c1', identificador_nacional: '25464260000149' })],
    [],
  )
  assert.equal(r.vinculos.length, 1)
})

test('cobertura já presa a outra análise não é adotada de novo', () => {
  const r = casarPedidosComCoberturas(
    [{ analise_id: 'a1', cnpj: '25464260000149' }],
    [cobertura({ case_id: 'antiga' })],
    ['antiga'],
  )
  assert.equal(r.vinculos.length, 0)
  assert.equal(r.ambiguos.length, 0)
})

test('o histórico preso sai da conta e a cobertura nova sozinha vira vínculo', () => {
  const r = casarPedidosComCoberturas(
    [{ analise_id: 'a1', cnpj: '25464260000149' }],
    [cobertura({ case_id: 'antiga' }), cobertura({ case_id: 'nova' })],
    ['antiga'],
  )
  assert.deepEqual(
    r.vinculos.map((v) => v.cobertura.case_id),
    ['nova'],
  )
})

test('cobertura sem CNPJ nunca casa — nome de buyer não é identidade', () => {
  const r = casarPedidosComCoberturas(
    [{ analise_id: 'a1', cnpj: '25464260000149' }],
    [
      cobertura({
        case_id: 'c1',
        identificador_nacional: null,
        nome_buyer: 'NEOBETEL EPI LTDA',
      }),
    ],
    [],
  )
  assert.equal(r.vinculos.length, 0)
  assert.equal(r.ambiguos.length, 0)
})

test('identificador que não tem 14 dígitos não é CNPJ', () => {
  const r = casarPedidosComCoberturas(
    [{ analise_id: 'a1', cnpj: '25464260000149' }],
    [cobertura({ case_id: 'c1', identificador_nacional: 'BE0123456789' })],
    [],
  )
  assert.equal(r.vinculos.length, 0)
})

test('duas coberturas livres para o mesmo CNPJ não escolhem: acusam', () => {
  const r = casarPedidosComCoberturas(
    [{ analise_id: 'a1', cnpj: '25464260000149' }],
    [
      cobertura({ case_id: 'c1', limite_aprovado: 500_000 }),
      cobertura({ case_id: 'c2', limite_aprovado: 1_500_000 }),
    ],
    [],
  )
  assert.equal(r.vinculos.length, 0)
  assert.equal(r.ambiguos.length, 1)
  assert.equal(r.ambiguos[0]?.motivo, 'mais_de_uma_cobertura')
  assert.deepEqual(r.ambiguos[0]?.case_ids.sort(), ['c1', 'c2'])
})

test('dois pedidos abertos do mesmo CNPJ não escolhem: acusam', () => {
  const r = casarPedidosComCoberturas(
    [
      { analise_id: 'a1', cnpj: '25464260000149' },
      { analise_id: 'a2', cnpj: '25464260000149' },
    ],
    [cobertura({ case_id: 'c1' })],
    [],
  )
  assert.equal(r.vinculos.length, 0)
  assert.equal(r.ambiguos[0]?.motivo, 'mais_de_um_pedido')
  assert.deepEqual(r.ambiguos[0]?.analise_ids.sort(), ['a1', 'a2'])
})

test('CNPJ sem cobertura nenhuma é silêncio, não ambiguidade', () => {
  const r = casarPedidosComCoberturas(
    [{ analise_id: 'a1', cnpj: '61074829000123' }],
    [cobertura({ case_id: 'c1', identificador_nacional: '25464260000149' })],
    [],
  )
  assert.equal(r.vinculos.length, 0)
  assert.equal(r.ambiguos.length, 0)
})

test('o mesmo cover nas duas listagens conta uma vez, e a última leitura vence', () => {
  const r = casarPedidosComCoberturas(
    [{ analise_id: 'a1', cnpj: '25464260000149' }],
    [
      // O portfólio traz a cobertura ainda sem decisão…
      cobertura({ case_id: 'c1', estagio: 'em_analise', limite_aprovado: null }),
      // …e a listagem de decisões, por cima, traz a mesma já decidida.
      cobertura({ case_id: 'c1', estagio: 'aprovada', limite_aprovado: 1_500_000 }),
    ],
    [],
  )
  assert.equal(r.ambiguos.length, 0)
  assert.equal(r.vinculos.length, 1)
  assert.equal(r.vinculos[0]?.cobertura.estagio, 'aprovada')
  assert.equal(r.vinculos[0]?.cobertura.limite_aprovado, 1_500_000)
})

test('cada CNPJ é resolvido por si: um vincula enquanto o outro acusa', () => {
  const r = casarPedidosComCoberturas(
    [
      { analise_id: 'hitachi', cnpj: '61074829000123' },
      { analise_id: 'neobetel', cnpj: '25464260000149' },
    ],
    [
      cobertura({ case_id: 'h1', identificador_nacional: '61074829000123' }),
      cobertura({ case_id: 'n1', identificador_nacional: '25464260000149' }),
      cobertura({ case_id: 'n2', identificador_nacional: '25464260000149' }),
    ],
    [],
  )
  assert.deepEqual(
    r.vinculos.map((v) => [v.analise_id, v.cobertura.case_id]),
    [['hitachi', 'h1']],
  )
  assert.deepEqual(
    r.ambiguos.map((a) => a.analise_ids),
    [['neobetel']],
  )
})
