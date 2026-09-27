import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agruparNotificacoes, ErroAgrupamento, type TituloParaAgrupar } from './agrupamento.ts'

const MATRIZ = '11111111000191'
const t = (
  id: string,
  sacado: string,
  cedente = '99999999000100',
  cedenteMatriz = cedente,
  matriz = MATRIZ,
): TituloParaAgrupar => ({
  id,
  sacado_cnpj: sacado,
  sacado_matriz_cnpj: matriz,
  cedente_cnpj: cedente,
  cedente_matriz_cnpj: cedenteMatriz,
})

const soSacado = { escopo: 'sacado', notificarMatrizCedente: true } as const
const comCedente = { escopo: 'sacado_e_cedente', notificarMatrizCedente: true } as const

test('título cujo sacado é a própria matriz não duplica a carta da matriz', () => {
  const r = agruparNotificacoes([t('a', MATRIZ), t('b', MATRIZ)], soSacado)
  assert.equal(r.length, 1)
  assert.deepEqual(r[0], { papel: 'sacado_matriz', destinatario_cnpj: MATRIZ, titulo_ids: ['a', 'b'] })
})

test('grupo com 1 SPE: a matriz recebe o consolidado e a SPE só o dela', () => {
  const r = agruparNotificacoes([t('a', MATRIZ), t('b', '22222222000100')], soSacado)
  assert.equal(r.length, 2)
  assert.deepEqual(r[0], { papel: 'sacado_matriz', destinatario_cnpj: MATRIZ, titulo_ids: ['a', 'b'] })
  assert.deepEqual(r[1], { papel: 'sacado_filial', destinatario_cnpj: '22222222000100', titulo_ids: ['b'] })
})

test('só a SPE deve: a matriz ainda recebe o consolidado (responde pelo conjunto)', () => {
  const r = agruparNotificacoes([t('a', '22222222000100')], soSacado)
  assert.deepEqual(
    r.map((n) => [n.papel, n.destinatario_cnpj, n.titulo_ids]),
    [
      ['sacado_matriz', MATRIZ, ['a']],
      ['sacado_filial', '22222222000100', ['a']],
    ],
  )
})

test('grupo com 5 SPEs e 3 cedentes: 1 matriz + 5 SPEs + 3 cedentes', () => {
  const spes = ['20000000000101', '20000000000202', '20000000000303', '20000000000404', '20000000000505']
  const cedentes = ['30000000000101', '30000000000202', '30000000000303']
  const titulos: TituloParaAgrupar[] = []
  let n = 0
  for (const spe of spes) {
    for (const ced of cedentes) titulos.push(t(`t${n++}`, spe, ced))
  }
  const r = agruparNotificacoes(titulos, comCedente)
  const porPapel = (p: string) => r.filter((x) => x.papel === p)

  assert.equal(porPapel('sacado_matriz').length, 1)
  assert.equal(porPapel('sacado_matriz')[0]!.titulo_ids.length, 15)
  assert.equal(porPapel('sacado_filial').length, 5)
  for (const f of porPapel('sacado_filial')) assert.equal(f.titulo_ids.length, 3)
  // cedente sem filial: é a própria matriz dele, uma carta com os 5 títulos (um por SPE)
  assert.equal(porPapel('cedente_matriz').length, 3)
  for (const c of porPapel('cedente_matriz')) assert.equal(c.titulo_ids.length, 5)
  assert.equal(porPapel('cedente_filial').length, 0)
  assert.equal(r.length, 9)
})

test('cedente com filial: matriz do cedente consolida, filial recebe o dela', () => {
  const CED_MATRIZ = '40000000000191'
  const CED_FILIAL = '40000000000272'
  const r = agruparNotificacoes(
    [t('a', MATRIZ, CED_MATRIZ, CED_MATRIZ), t('b', MATRIZ, CED_FILIAL, CED_MATRIZ)],
    comCedente,
  )
  const cedentes = r.filter((n) => n.papel.startsWith('cedente'))
  assert.deepEqual(
    cedentes.map((n) => [n.papel, n.destinatario_cnpj, n.titulo_ids]),
    [
      ['cedente_matriz', CED_MATRIZ, ['a', 'b']],
      ['cedente_filial', CED_FILIAL, ['b']],
    ],
  )
})

test('cedente com filial e sem consolidar na matriz: cada CNPJ recebe o que cedeu', () => {
  const CED_MATRIZ = '40000000000191'
  const CED_FILIAL = '40000000000272'
  const r = agruparNotificacoes([t('b', MATRIZ, CED_FILIAL, CED_MATRIZ)], {
    escopo: 'sacado_e_cedente',
    notificarMatrizCedente: false,
  })
  const cedentes = r.filter((n) => n.papel.startsWith('cedente'))
  assert.deepEqual(cedentes, [{ papel: 'cedente_filial', destinatario_cnpj: CED_FILIAL, titulo_ids: ['b'] }])
})

test("escopo = 'sacado' não gera nenhuma notificação de cedente", () => {
  const r = agruparNotificacoes([t('a', MATRIZ, '30000000000101'), t('b', '22222222000100', '30000000000202')], soSacado)
  assert.equal(r.filter((n) => n.papel.startsWith('cedente')).length, 0)
})

test('seleção com títulos de dois grupos diferentes é recusada', () => {
  assert.throws(
    () => agruparNotificacoes([t('a', MATRIZ), t('b', '55555555000155', undefined, undefined, '55555555000155')], soSacado),
    (e: unknown) => e instanceof ErroAgrupamento && e.codigo === 'grupos_diferentes',
  )
})

test('seleção vazia é recusada', () => {
  assert.throws(() => agruparNotificacoes([], soSacado), ErroAgrupamento)
})
