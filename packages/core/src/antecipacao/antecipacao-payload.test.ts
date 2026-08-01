import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  extrairAntecipacoes,
  normalizarAntecipacaoPayload,
  totalDePaginasAntecipacoes,
  type AntecipacaoPayload,
} from './antecipacao-payload.ts'

/**
 * O payload REAL do endpoint, como fixture. É o mesmo motivo de
 * `nf-payload.test.ts`: o contrato de terceiro é a superfície onde um typecheck
 * verde convive com zero linhas sincronizadas.
 */

const REAL: AntecipacaoPayload = {
  id: 13859,
  status: 'APPROVED',
  anticipationType: 'D0',
  documentNumber: '84',
  requestDate: '2026-08-03',
  createdAt: '2026-07-31T15:03:18',
  originalDueDate: '2026-08-14',
  completionDate: null,
  anticipationDays: 11,
  grossValue: 42800.0,
  witholdTaxAmount: 4280.0,
  discountedAmount: 38520.0,
  netValue: 37854.4,
  totalSpreadAmount: 665.6,
  monthlyInterestRate: 2.35,
  contractor: { name: 'CONSTRUTORA EXEMPLO LTDA', taxId: '12345678000190' },
  contracted: { name: 'FORNECEDOR EXEMPLO LTDA', taxId: '98765432000110' },
  approvalWithAutomation: false,
  invoiceCancelledAt: null,
}

test('o payload real vira uma linha completa', () => {
  const r = normalizarAntecipacaoPayload(REAL)
  assert.equal(r.ok, true)
  if (!r.ok) return
  const a = r.antecipacao

  assert.equal(a.id_externo, 13859)
  assert.equal(a.status, 'APPROVED')
  assert.equal(a.anticipation_type, 'D0')
  assert.equal(a.document_number, '84')
  assert.equal(a.numero_normalizado, '84')
  assert.equal(a.anticipation_days, 11)
  assert.equal(a.gross_value, 42800)
  assert.equal(a.withhold_tax, 4280)
  assert.equal(a.discounted_amount, 38520)
  assert.equal(a.net_value, 37854.4)
  assert.equal(a.total_spread, 665.6)
  assert.equal(a.monthly_interest_rate, 2.35)
  assert.equal(a.approval_with_automation, false)
  assert.equal(a.invoice_cancelled_at, null)
})

test('contractor é o SACADO e contracted é o FORNECEDOR', () => {
  // A inversão mais cara do módulo: trocados, o matching nunca acha candidata e
  // 100% das antecipações viram `sem_nf` sem nenhum erro registrado.
  const r = normalizarAntecipacaoPayload(REAL)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.antecipacao.sacado_cnpj, '12345678000190')
  assert.equal(r.antecipacao.fornecedor_cnpj, '98765432000110')
  assert.equal(r.antecipacao.sacado_nome, 'CONSTRUTORA EXEMPLO LTDA')
  assert.equal(r.antecipacao.fornecedor_nome, 'FORNECEDOR EXEMPLO LTDA')
})

test('createdAt sem fuso é carimbado em São Paulo, não em UTC', () => {
  // Deixar o Postgres assumir UTC deslocaria a base em 3h — o bastante para a
  // janela de 3 dias perder as antecipações da madrugada.
  const r = normalizarAntecipacaoPayload(REAL)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.antecipacao.created_at_plataforma, '2026-07-31T15:03:18-03:00')
})

test('um fuso explícito é preservado como veio', () => {
  const r = normalizarAntecipacaoPayload({ ...REAL, createdAt: '2026-07-31T18:03:18Z' })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.antecipacao.created_at_plataforma, '2026-07-31T18:03:18Z')
})

test('datas de dia perdem a hora; timestamps a preservam', () => {
  const r = normalizarAntecipacaoPayload({
    ...REAL,
    requestDate: '2026-08-03T00:00:00',
    completionDate: '2026-08-05T09:12:00',
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.antecipacao.request_date, '2026-08-03')
  assert.equal(r.antecipacao.completion_date, '2026-08-05T09:12:00-03:00')
})

test('o número normalizado sai da MESMA função da NF', () => {
  const r = normalizarAntecipacaoPayload({ ...REAL, documentNumber: '0084/1' })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.antecipacao.document_number, '0084/1')
  assert.equal(r.antecipacao.numero_normalizado, '84')
})

test('CNPJ pontuado é aceito; faltando um dos dois, a linha é descartada', () => {
  const pontuado = normalizarAntecipacaoPayload({
    ...REAL,
    contractor: { name: 'X', taxId: '12.345.678/0001-90' },
  })
  assert.equal(pontuado.ok, true)
  if (pontuado.ok) assert.equal(pontuado.antecipacao.sacado_cnpj, '12345678000190')

  const semSacado = normalizarAntecipacaoPayload({ ...REAL, contractor: null })
  assert.equal(semSacado.ok, false)
  if (!semSacado.ok) assert.equal(semSacado.motivo, 'sem_cnpj')
})

test('sem id não há chave de idempotência — descarta', () => {
  const r = normalizarAntecipacaoPayload({ ...REAL, id: null })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.motivo, 'sem_id')
})

test('status vem maiúsculo mesmo quando a API muda de humor', () => {
  const r = normalizarAntecipacaoPayload({ ...REAL, status: 'approved' })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.antecipacao.status, 'APPROVED')
})

test('a resposta é lida em data, items ou array cru', () => {
  assert.equal(extrairAntecipacoes({ data: [REAL] }).length, 1)
  assert.equal(extrairAntecipacoes({ items: [REAL] }).length, 1)
  assert.equal(extrairAntecipacoes({} as never).length, 0)
  assert.equal(totalDePaginasAntecipacoes({ totalPages: 3 }), 3)
  assert.equal(totalDePaginasAntecipacoes({ total_pages: 4 }), 4)
})
