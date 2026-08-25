import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calcularMunicao, entraNoFunil, type NotaDoFornecedor } from './municao.ts'

const HOJE = new Date('2026-08-25T12:00:00Z')

function nf(p: Partial<NotaDoFornecedor>): NotaDoFornecedor {
  return {
    sacado_cnpj: '11222333000144',
    sacado_nome: 'CONSTRUTORA A',
    valor: 100_000,
    emitida_em: '2026-08-01',
    vencimento: '2026-09-01',
    ...p,
  }
}

test('volume e contagem só olham 90 dias; a última NF olha a janela inteira', () => {
  const m = calcularMunicao(
    [
      nf({ valor: 100_000, emitida_em: '2026-08-20' }),
      nf({ valor: 50_000, emitida_em: '2026-07-01' }),
      nf({ valor: 900_000, emitida_em: '2026-03-01' }), // fora dos 90 dias
    ],
    { hoje: HOJE },
  )
  assert.equal(m.volume_90d, 150_000)
  assert.equal(m.qtd_nfs_90d, 2)
  // A nota velha não infla o volume, mas continua contando como sinal de vida.
  assert.equal(m.ultima_nf_em, '2026-08-20')
})

test('potencial mensal é volume 90d ÷ 3, e nada além disso', () => {
  const m = calcularMunicao([nf({ valor: 300_000, emitida_em: '2026-08-01' })], { hoje: HOJE })
  assert.equal(m.potencial_mensal, 100_000)
})

test('o prazo médio é ponderado por valor — uma nota de R$ 500 não pesa como uma de R$ 500 mil', () => {
  const m = calcularMunicao(
    [
      nf({ valor: 500, emitida_em: '2026-08-01', vencimento: '2026-08-08' }), // 7 dias
      nf({ valor: 500_000, emitida_em: '2026-08-01', vencimento: '2026-10-30' }), // 90 dias
    ],
    { hoje: HOJE },
  )
  // Média simples daria 48. A ponderada diz o que a carteira realmente parece.
  assert.equal(m.prazo_medio_dias, 90)
})

test('vencimento anterior à emissão é dado corrompido: fica fora da média, dentro do volume', () => {
  const m = calcularMunicao(
    [
      nf({ valor: 100_000, emitida_em: '2026-08-01', vencimento: '2026-07-01' }),
      nf({ valor: 100_000, emitida_em: '2026-08-01', vencimento: '2026-08-31' }),
    ],
    { hoje: HOJE },
  )
  assert.equal(m.volume_90d, 200_000)
  assert.equal(m.prazo_medio_dias, 30)
})

test('sem nenhum vencimento, o prazo é null e não zero', () => {
  const m = calcularMunicao([nf({ vencimento: null })], { hoje: HOJE })
  assert.equal(m.prazo_medio_dias, null)
})

test('sacados principais saem por valor e trazem a contagem de notas', () => {
  const m = calcularMunicao(
    [
      nf({ sacado_cnpj: '111', sacado_nome: 'A', valor: 10_000 }),
      nf({ sacado_cnpj: '222', sacado_nome: 'B', valor: 90_000 }),
      nf({ sacado_cnpj: '222', sacado_nome: 'B', valor: 10_000 }),
    ],
    { hoje: HOJE },
  )
  assert.deepEqual(
    m.sacados_principais.map((s) => [s.cnpj, s.valor, s.notas]),
    [
      ['222', 100_000, 2],
      ['111', 10_000, 1],
    ],
  )
})

test('o corte de volume é o que separa 688 leads de 7.892 nomes', () => {
  const grande = calcularMunicao([nf({ valor: 60_000 })], { hoje: HOJE })
  const pequeno = calcularMunicao([nf({ valor: 4_000 })], { hoje: HOJE })
  assert.equal(entraNoFunil(grande, 50_000), true)
  assert.equal(entraNoFunil(pequeno, 50_000), false)
  // Exatamente no corte entra: o operador escolheu "a partir de".
  assert.equal(entraNoFunil(calcularMunicao([nf({ valor: 50_000 })], { hoje: HOJE }), 50_000), true)
})

test('fornecedor sem nota nenhuma não quebra a conta', () => {
  const m = calcularMunicao([], { hoje: HOJE })
  assert.equal(m.volume_90d, 0)
  assert.equal(m.potencial_mensal, 0)
  assert.equal(m.ultima_nf_em, null)
  assert.deepEqual(m.sacados_principais, [])
})
