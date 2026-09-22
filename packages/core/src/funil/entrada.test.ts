import assert from 'node:assert/strict'
import { test } from 'node:test'
import { preAutorizacaoEntraNoFunil, tituloEntraNoFunil } from './entrada.ts'
import { CONFIG_FUNIL_OPORTUNIDADES_PADRAO } from './schemas.ts'

const CFG = CONFIG_FUNIL_OPORTUNIDADES_PADRAO
const HOJE = new Date('2026-09-22T12:00:00Z')

test('WAITING_CONTRACTED entra sempre, inclusive expirando hoje', () => {
  assert.deepEqual(
    preAutorizacaoEntraNoFunil(
      { status: 'WAITING_CONTRACTED', expira_em: '2026-09-22', criada_em: '2026-09-19' },
      CFG,
      HOJE,
    ),
    { entra: true },
  )
})

test('ANTICIPATION_REQUESTED não entra: já converteu', () => {
  assert.deepEqual(
    preAutorizacaoEntraNoFunil(
      { status: 'ANTICIPATION_REQUESTED', expira_em: null, criada_em: '2026-09-20' },
      CFG,
      HOJE,
    ),
    { entra: false, motivo: 'ja_converteu' },
  )
})

test('expirada ontem entra (é telefonema); expirada há dois meses, não', () => {
  const ontem = preAutorizacaoEntraNoFunil(
    { status: 'EXPIRED', expira_em: '2026-09-21', criada_em: '2026-09-15' },
    CFG,
    HOJE,
  )
  assert.deepEqual(ontem, { entra: true })

  const antiga = preAutorizacaoEntraNoFunil(
    { status: 'EXPIRED', expira_em: '2026-07-20', criada_em: '2026-07-10' },
    CFG,
    HOJE,
  )
  assert.deepEqual(antiga, { entra: false, motivo: 'fora_da_janela_de_recuperacao' })
})

test('status desconhecido ENTRA — invisível e errado é pior que visível e estranho', () => {
  assert.deepEqual(
    preAutorizacaoEntraNoFunil(
      { status: 'SOMETHING_NEW', expira_em: null, criada_em: '2026-09-21' },
      CFG,
      HOJE,
    ),
    { entra: true },
  )
})

test('offer_created ENTRA: é a parcela mais quente, e leva o selo da oferta', () => {
  assert.deepEqual(tituloEntraNoFunil({ situation: 'offer_created', guard_reason: null }, CFG), {
    entra: true,
  })
})

test('paid_in_erp e removed_in_erp não entram — viram métrica de perda', () => {
  assert.deepEqual(tituloEntraNoFunil({ situation: 'paid_in_erp', guard_reason: null }, CFG), {
    entra: false,
    motivo: 'pago_no_erp',
  })
  assert.deepEqual(tituloEntraNoFunil({ situation: 'removed_in_erp', guard_reason: null }, CFG), {
    entra: false,
    motivo: 'removido_no_erp',
  })
})

test('removed_in_erp vence mesmo com anticipation preenchido', () => {
  /*
   * §2.2: `removed_in_erp` mantém `anticipation` como HISTÓRICO da operação
   * cancelada. Quem ler o anticipation primeiro verá uma parcela removida com
   * cara de convertida — e ela entraria no relatório como receita que não existe.
   * A regra é de situação, e a situação vem antes.
   */
  assert.deepEqual(
    tituloEntraNoFunil({ situation: 'removed_in_erp', guard_reason: 'ANYTHING' }, CFG),
    { entra: false, motivo: 'removido_no_erp' },
  )
})

test('not_eligible só entra com guardReason que um originador resolve', () => {
  assert.deepEqual(
    tituloEntraNoFunil({ situation: 'not_eligible', guard_reason: 'SUPPLIER_CNPJ_MISSING' }, CFG),
    { entra: true },
  )
  assert.deepEqual(
    tituloEntraNoFunil({ situation: 'not_eligible', guard_reason: 'CREDIT_LIMIT_EXCEEDED' }, CFG),
    { entra: false, motivo: 'guard_reason_nao_recuperavel' },
  )
  assert.deepEqual(tituloEntraNoFunil({ situation: 'not_eligible', guard_reason: null }, CFG), {
    entra: false,
    motivo: 'guard_reason_nao_recuperavel',
  })
})
