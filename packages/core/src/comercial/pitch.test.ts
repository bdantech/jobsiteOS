import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resumirCadeiaDoSacado, type NotaContraOSacado } from './pitch.ts'

const HOJE = new Date('2026-09-03T12:00:00Z')

const nota = (n: Partial<NotaContraOSacado>): NotaContraOSacado => ({
  fornecedor_cnpj: '11111111000191',
  fornecedor_nome: 'SERRALHERIA X LTDA',
  fornecedor_cadastrado: false,
  valor: 1000,
  emitida_em: '2026-08-01',
  vencimento: '2026-09-30',
  ...n,
})

test('agrupa por fornecedor e ordena pelos maiores', () => {
  const r = resumirCadeiaDoSacado(
    [
      nota({ valor: 100 }),
      nota({ valor: 400 }),
      nota({ fornecedor_cnpj: '22222222000191', fornecedor_nome: 'ELÉTRICA Y', valor: 900 }),
    ],
    { hoje: HOJE },
  )
  assert.equal(r.notas, 3)
  assert.equal(r.valor_total, 1400)
  assert.equal(r.fornecedores_distintos, 2)
  assert.equal(r.principais[0]?.nome, 'ELÉTRICA Y')
  assert.equal(r.principais[1]?.valor, 500)
  assert.equal(r.principais[1]?.notas, 2)
})

test('fora da janela de 180 dias não conta — mas a data mais recente é só da janela', () => {
  const r = resumirCadeiaDoSacado(
    [nota({ emitida_em: '2025-01-10', valor: 999_999 }), nota({ emitida_em: '2026-07-15' })],
    { hoje: HOJE },
  )
  assert.equal(r.notas, 1)
  assert.equal(r.valor_total, 1000)
  assert.equal(r.ultima_nota_em, '2026-07-15')
})

test('prazo médio é ponderado por valor: é a nota grande que a tesouraria sente', () => {
  const r = resumirCadeiaDoSacado(
    [
      nota({ valor: 10, emitida_em: '2026-08-01', vencimento: '2026-08-11' }), // 10 dias
      nota({ valor: 990, emitida_em: '2026-08-01', vencimento: '2026-10-30' }), // 90 dias
    ],
    { hoje: HOJE },
  )
  // Média simples daria 50. Ponderada dá 89 — e é ela que descreve o prazo real.
  assert.equal(r.prazo_medio_dias, 89)
})

test('nota sem vencimento não zera o prazo; nenhuma com vencimento devolve null', () => {
  const semPrazo = resumirCadeiaDoSacado([nota({ vencimento: null })], { hoje: HOJE })
  assert.equal(semPrazo.prazo_medio_dias, null)
  assert.equal(semPrazo.notas, 1)

  const misto = resumirCadeiaDoSacado(
    [nota({ vencimento: null }), nota({ emitida_em: '2026-08-01', vencimento: '2026-09-01' })],
    { hoje: HOJE },
  )
  assert.equal(misto.prazo_medio_dias, 31)
})

test('vencimento anterior à emissão é descartado, não vira prazo negativo', () => {
  const r = resumirCadeiaDoSacado(
    [
      nota({ valor: 100, emitida_em: '2026-08-10', vencimento: '2026-08-01' }),
      nota({ valor: 100, emitida_em: '2026-08-10', vencimento: '2026-09-09' }),
    ],
    { hoje: HOJE },
  )
  assert.equal(r.prazo_medio_dias, 30)
})

test('cadastrado contamina o agrupamento: uma nota basta para o fornecedor ser cliente', () => {
  const r = resumirCadeiaDoSacado(
    [nota({ fornecedor_cadastrado: false }), nota({ fornecedor_cadastrado: true })],
    { hoje: HOJE },
  )
  assert.equal(r.principais[0]?.cadastrado, true)
  assert.equal(r.fornecedores_cadastrados, 1)
})

test('nota sem CNPJ soma no total e não vira fornecedor fantasma', () => {
  const r = resumirCadeiaDoSacado(
    [nota({ fornecedor_cnpj: null, valor: 700 }), nota({ valor: 300 })],
    { hoje: HOJE },
  )
  assert.equal(r.valor_total, 1000)
  assert.equal(r.fornecedores_distintos, 1)
})
