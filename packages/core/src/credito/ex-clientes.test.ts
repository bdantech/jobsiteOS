import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classificarCnpj, mesesDesde, type AnaliseDoCnpj } from './ex-clientes.ts'

const HOJE = '2026-08-15'

function analise(over: Partial<AnaliseDoCnpj> = {}): AnaliseDoCnpj {
  return { status: 'approved', expiration_date: '2027-01-01', empresa_cadastrada: true, ...over }
}

test('análise aprovada e válida hoje é cliente vigente — este sync não mexe', () => {
  const r = classificarCnpj([analise({ expiration_date: '2026-12-31' })], {}, HOJE)
  assert.equal(r.situacao, 'analise_vigente')
  assert.equal(r.exClienteDesde, null)
})

test('a fronteira é o próprio dia: expira hoje ainda vale, ontem não', () => {
  assert.equal(classificarCnpj([analise({ expiration_date: HOJE })], {}, HOJE).situacao, 'analise_vigente')
  assert.equal(
    classificarCnpj([analise({ expiration_date: '2026-08-14' })], {}, HOJE).situacao,
    'ex_cliente',
  )
})

test('aprovada sem data de validade não vence — não se rebaixa por campo em branco', () => {
  const r = classificarCnpj([analise({ expiration_date: null })], {}, HOJE)
  assert.equal(r.situacao, 'analise_vigente')
})

test('ex-cliente: teve aprovada, nenhuma vale hoje, e é cadastrada', () => {
  const r = classificarCnpj(
    [
      analise({ expiration_date: '2025-03-10' }),
      analise({ expiration_date: '2026-02-28' }),
      analise({ status: 'expired', expiration_date: '2026-07-01' }),
    ],
    {},
    HOJE,
  )
  assert.equal(r.situacao, 'ex_cliente')
  // A MAIOR expiração entre as APROVADAS — 2026-07-01 é de uma expired, não conta.
  assert.equal(r.exClienteDesde, '2026-02-28')
})

test('nunca aprovada nunca foi cliente — negada sem limite não vira ex-cliente', () => {
  const r = classificarCnpj(
    [
      analise({ status: 'denied', expiration_date: '2025-01-01', credit_limit: 0, consumed_limit: 0 }),
      analise({ status: 'expired', credit_limit: null, consumed_limit: null }),
    ],
    {},
    HOJE,
  )
  assert.equal(r.situacao, 'sem_analise_aprovada')
  assert.equal(r.ultimaAprovada, null)
})

/**
 * O vocabulário REAL do endpoint, aprendido na primeira carga: não existe `expired`.
 * Existem `approved` e `blocked`, e os `blocked` são as saídas — 21 de 74 na base,
 * todos com limite consumido e nenhum no temperature report. Exigir `approved` para
 * reconhecer que houve relação fazia a lista inteira de ex-clientes nascer vazia.
 */
test('blocked com limite concedido É ex-cliente — é o vocabulário real da fonte', () => {
  const r = classificarCnpj(
    [analise({ status: 'blocked', expiration_date: '2025-12-31', credit_limit: 212718.57, consumed_limit: 212718.57 })],
    {},
    HOJE,
  )
  assert.equal(r.situacao, 'ex_cliente')
  assert.equal(r.exClienteDesde, '2025-12-31')
})

test('blocked com data FUTURA também é ex-cliente: bloqueado não opera', () => {
  const r = classificarCnpj(
    [analise({ status: 'blocked', expiration_date: '2026-12-31', credit_limit: 2000000, consumed_limit: 16461.6 })],
    {},
    HOJE,
  )
  assert.equal(r.situacao, 'ex_cliente')
})

test('mas o temperature report continua ganhando do blocked', () => {
  const r = classificarCnpj(
    [analise({ status: 'blocked', expiration_date: '2025-12-31', credit_limit: 500000 })],
    { statusOnepay: 'active' },
    HOJE,
  )
  assert.equal(r.situacao, 'conflito')
})

test('a regra de ouro da fonte: sem cadastro não é ex-cliente, é outra categoria', () => {
  const vencida = classificarCnpj(
    [analise({ empresa_cadastrada: false, expiration_date: '2025-01-01' })],
    {},
    HOJE,
  )
  assert.equal(vencida.situacao, 'analise_sem_cadastro')

  // Vale também quando a análise está VIGENTE: aprovada, no ar, e ninguém operou.
  const vigente = classificarCnpj([analise({ empresa_cadastrada: false })], {}, HOJE)
  assert.equal(vigente.situacao, 'analise_sem_cadastro')
})

test('uma aprovada com cadastro basta para o CNPJ ter existido na plataforma', () => {
  const r = classificarCnpj(
    [
      analise({ empresa_cadastrada: false, expiration_date: '2024-01-01' }),
      analise({ empresa_cadastrada: true, expiration_date: '2026-01-31' }),
    ],
    {},
    HOJE,
  )
  assert.equal(r.situacao, 'ex_cliente')
  assert.equal(r.exClienteDesde, '2026-01-31')
})

test('o temperature report ganha: cliente ativo vira conflito, não rebaixamento', () => {
  const r = classificarCnpj([analise({ expiration_date: '2026-01-31' })], { statusOnepay: 'active' }, HOJE)
  assert.equal(r.situacao, 'conflito')
  assert.equal(r.motivoConflito, 'cliente_ativo_no_temperature_report')
  assert.equal(r.exClienteDesde, null, 'conflito não grava data de saída')
})

test('conversão recente também blinda', () => {
  const r = classificarCnpj(
    [analise({ expiration_date: '2026-01-31' })],
    { converteuRecentemente: true },
    HOJE,
  )
  assert.equal(r.situacao, 'conflito')
  assert.equal(r.motivoConflito, 'conversao_recente')
})

test('status inativo no temperature report não blinda — só `active` blinda', () => {
  const r = classificarCnpj([analise({ expiration_date: '2026-01-31' })], { statusOnepay: 'inactive' }, HOJE)
  assert.equal(r.situacao, 'ex_cliente')
})

test('status vem do endpoint e pode chegar em qualquer caixa', () => {
  assert.equal(classificarCnpj([analise({ status: 'APPROVED' })], {}, HOJE).situacao, 'analise_vigente')
  assert.equal(
    classificarCnpj([analise({ expiration_date: '2020-01-01' })], { statusOnepay: 'ACTIVE' }, HOJE).situacao,
    'conflito',
  )
})

test('sem análise nenhuma não é ex-cliente', () => {
  assert.equal(classificarCnpj([], {}, HOJE).situacao, 'sem_analise_aprovada')
})

/**
 * A reativação não é decidida aqui: quem promove `ex_cliente → cliente` é o sync do
 * temperature report (03). O que este classificador garante é que, no dia seguinte à
 * reativação, ele NÃO rebaixe de novo — e é isso que o caso de conflito faz.
 */
test('reativado no temperature report não é rebaixado no dia seguinte', () => {
  const r = classificarCnpj(
    [analise({ expiration_date: '2026-05-01' })],
    { statusOnepay: 'active', converteuRecentemente: true },
    HOJE,
  )
  assert.equal(r.situacao, 'conflito')
})

test('mesesDesde só fecha o mês quando o dia passa', () => {
  assert.equal(mesesDesde('2026-01-15', '2026-02-14'), 0)
  assert.equal(mesesDesde('2026-01-15', '2026-02-15'), 1)
  assert.equal(mesesDesde('2025-08-15', '2026-08-15'), 12)
  assert.equal(mesesDesde(null, HOJE), null)
  // Data no futuro não vira número negativo na tela.
  assert.equal(mesesDesde('2027-01-01', HOJE), 0)
})
