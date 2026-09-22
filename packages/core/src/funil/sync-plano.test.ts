import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diaNoFuso, montarJanelaFunil, querystringFunil } from './sync-plano.ts'
import { CONFIG_FUNIL_OPORTUNIDADES_PADRAO as CFG } from './schemas.ts'

test('a borda do dia é a de BRASÍLIA, não a de UTC', () => {
  // 22:30 em São Paulo = 01:30 UTC do dia seguinte. Em UTC a janela já teria
  // virado, e as horas mais movimentadas do dia (o fechamento do ERP) sairiam dela.
  assert.equal(diaNoFuso(new Date('2026-09-23T01:30:00Z')), '2026-09-22')
  assert.equal(diaNoFuso(new Date('2026-09-23T03:30:00Z')), '2026-09-23')
})

test('a janela curta cobre os 7 dias de entrada, inclusivos nas duas pontas', () => {
  const j = montarJanelaFunil('novidade', new Date('2026-09-22T12:00:00Z'), CFG)
  assert.equal(j.de, '2026-09-16')
  assert.equal(j.ate, '2026-09-22')
})

test('a varredura de estado respeita o teto de 92 dias do endpoint', () => {
  const j = montarJanelaFunil('estado', new Date('2026-09-22T12:00:00Z'), {
    janela_novidade_dias: 7,
    // Uma config exagerada não pode virar 400 em produção.
    janela_estado_dias: 92,
  })
  assert.equal(j.ate, '2026-09-22')
  assert.equal(j.de, '2026-06-23')
})

test('a querystring usa os nomes que o endpoint espera', () => {
  const qs = querystringFunil({ de: '2026-09-16', ate: '2026-09-22' }, 2, 200)
  assert.equal(qs, 'page=2&page_size=200&start_date=2026-09-16&end_date=2026-09-22')
})
