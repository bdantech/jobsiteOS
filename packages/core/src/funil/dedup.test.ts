import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chaveDedup, deduplicarFunil, type EntradaDedup } from './dedup.ts'

/**
 * Os casos difíceis do §5, cada um escrito porque erraria em produção de um jeito
 * que nenhum typecheck pega: o card simplesmente não aparece, e ninguém procura o
 * que não sabe que existe.
 */

const VAZIO: EntradaDedup = { notas: [], preAutorizacoes: [], titulos: [] }

const nf = (over: Partial<EntradaDedup['notas'][number]> = {}) => ({
  access_key: '3'.repeat(44),
  sacado_matriz_cnpj: '11111111000191',
  fornecedor_cnpj: '22222222000122',
  numero_normalizado: '8821',
  valor: 10_000,
  vencimento: '2026-10-10',
  ...over,
})

const pre = (over: Partial<EntradaDedup['preAutorizacoes'][number]> = {}) => ({
  id_externo: 501,
  origin: 'nfe',
  status: 'WAITING_CONTRACTED',
  criada_em: '2026-09-20T12:00:00Z',
  sacado_matriz_cnpj: '11111111000191',
  fornecedor_cnpj: '22222222000122',
  numero_normalizado: '8821',
  valor: 10_000,
  vencimento: '2026-10-10',
  sienge_bill_id: null,
  sienge_installment_id: null,
  ...over,
})

const titulo = (over: Partial<EntradaDedup['titulos'][number]> = {}) => ({
  id_externo: 900,
  connection_id: 7,
  bill_id: 4242,
  installment_id: 1,
  bill_access_key: null,
  nfe_candidate_access_key: null,
  pre_autorizacao_id_externo: null,
  ...over,
})

test('pré-auth com original NF: some da lista e deixa o selo na nota', () => {
  const r = deduplicarFunil({ ...VAZIO, notas: [nf()], preAutorizacoes: [pre()] })

  assert.deepEqual(r.ocultacoes, [
    {
      tipo: 'pre_autorizacao',
      referencia_id: '501',
      motivo: 'tem_original',
      original_tipo: 'nf',
      original_id: '3'.repeat(44),
    },
  ])
  assert.equal(r.selos.length, 1)
  assert.equal(r.selos[0]?.referencia_id, '3'.repeat(44))
  assert.equal(r.selos[0]?.status, 'WAITING_CONTRACTED')
})

test('pré-auth com original título: o id do título manda, sem interpretar nada', () => {
  const r = deduplicarFunil({
    ...VAZIO,
    preAutorizacoes: [pre({ numero_normalizado: null })],
    titulos: [titulo({ pre_autorizacao_id_externo: 501 })],
  })

  assert.equal(r.ocultacoes.length, 1)
  assert.equal(r.ocultacoes[0]?.original_tipo, 'titulo')
  assert.equal(r.ocultacoes[0]?.original_id, '900')
})

test('pré-auth órfã é o próprio original — vira card, não some', () => {
  const r = deduplicarFunil({ ...VAZIO, preAutorizacoes: [pre({ origin: 'manual' })] })
  assert.deepEqual(r.ocultacoes, [])
  assert.deepEqual(r.selos, [])
})

test('título ↔ NF por accessKey, modo `titulo` (default): a parcela fica, a nota sai', () => {
  const chave = '3'.repeat(44)
  const r = deduplicarFunil(
    { ...VAZIO, notas: [nf()], titulos: [titulo({ bill_access_key: chave })] },
    'titulo',
  )

  assert.deepEqual(r.ocultacoes, [
    {
      tipo: 'nf',
      referencia_id: chave,
      motivo: 'duplicado_canal',
      original_tipo: 'titulo',
      original_id: '900',
    },
  ])
})

test('título ↔ NF por accessKey, modo `nf`: a nota fica, a parcela sai', () => {
  const chave = '3'.repeat(44)
  const r = deduplicarFunil(
    { ...VAZIO, notas: [nf()], titulos: [titulo({ nfe_candidate_access_key: chave })] },
    'nf',
  )

  assert.equal(r.ocultacoes.length, 1)
  assert.equal(r.ocultacoes[0]?.tipo, 'titulo')
  assert.equal(r.ocultacoes[0]?.original_id, chave)
})

test('sem accessKey dos dois lados não se deduplica — parcela não é nota', () => {
  const r = deduplicarFunil({ ...VAZIO, notas: [nf()], titulos: [titulo()] }, 'titulo')
  assert.deepEqual(r.ocultacoes, [])
})

test('ambiguidade entre duas NFs não esconde nada e vai para a revisão', () => {
  // Mesmo sacado, fornecedor e número; valores e vencimentos igualmente plausíveis.
  const a = nf({ access_key: 'A'.repeat(44), valor: 10_000, vencimento: '2026-10-10' })
  const b = nf({ access_key: 'B'.repeat(44), valor: 10_000, vencimento: '2026-10-10' })

  const r = deduplicarFunil({ ...VAZIO, notas: [a, b], preAutorizacoes: [pre()] })

  assert.deepEqual(r.ocultacoes, [])
  assert.deepEqual(r.selos, [])
  assert.equal(r.ambiguidades.length, 1)
  assert.equal(r.ambiguidades[0]?.motivo, 'varias_nfs')
  assert.deepEqual(r.ambiguidades[0]?.candidatos, [
    chaveDedup('nf', 'A'.repeat(44)),
    chaveDedup('nf', 'B'.repeat(44)),
  ])
})

test('o desempate resolve quando só UMA das candidatas é plausível', () => {
  const certa = nf({ access_key: 'A'.repeat(44), valor: 10_050, vencimento: '2026-10-12' })
  const outra = nf({ access_key: 'B'.repeat(44), valor: 80_000, vencimento: '2027-01-01' })

  const r = deduplicarFunil({ ...VAZIO, notas: [certa, outra], preAutorizacoes: [pre()] })

  assert.deepEqual(r.ambiguidades, [])
  assert.equal(r.ocultacoes[0]?.original_id, 'A'.repeat(44))
})

test('billId repetido entre conexões: dois títulos casam, nenhum esconde', () => {
  // §2.2: `bill.billId` só é único DENTRO de uma conexão, e a pré-auth não diz
  // de qual conexão veio.
  const r = deduplicarFunil({
    ...VAZIO,
    preAutorizacoes: [pre({ numero_normalizado: null, sienge_bill_id: 4242, sienge_installment_id: 1 })],
    titulos: [
      titulo({ id_externo: 900, connection_id: 7 }),
      titulo({ id_externo: 901, connection_id: 8 }),
    ],
  })

  assert.deepEqual(r.ocultacoes, [])
  assert.equal(r.ambiguidades[0]?.motivo, 'varios_titulos')
})

test('título de MATRIZ casa com pré-auth de SPE — as duas normalizadas pela matriz', () => {
  /*
   * O caso do §4.1: quando a parcela vira oferta, o sacado "fica mais específico".
   * O título aponta para a matriz (é a dona da conexão com o ERP) e a
   * pré-autorização pode apontar para a SPE do empreendimento. Isso NÃO é
   * divergência — e a prova é que o casamento tem de continuar funcionando.
   */
  const matriz = '11111111000191'
  const r = deduplicarFunil({
    ...VAZIO,
    notas: [nf({ sacado_matriz_cnpj: matriz })],
    // A pré-auth veio da SPE 11111111000272, mas normalizada pela matriz.
    preAutorizacoes: [pre({ sacado_matriz_cnpj: matriz })],
  })

  assert.equal(r.ocultacoes.length, 1)
  assert.equal(r.ocultacoes[0]?.original_tipo, 'nf')
})

test('a cadeia é resolvida: o selo pousa na parcela visível, não na NF escondida', () => {
  const chave = '3'.repeat(44)
  const r = deduplicarFunil(
    {
      notas: [nf({ access_key: chave })],
      preAutorizacoes: [pre()],
      titulos: [titulo({ bill_access_key: chave })],
    },
    'titulo',
  )

  // A NF sai (a parcela venceu); a pré-auth apontava para a NF e é REAPONTADA.
  const daPre = r.ocultacoes.find((o) => o.tipo === 'pre_autorizacao')
  assert.equal(daPre?.original_tipo, 'titulo')
  assert.equal(daPre?.original_id, '900')

  assert.equal(r.selos.length, 1)
  assert.equal(r.selos[0]?.tipo, 'titulo')
  assert.equal(r.selos[0]?.referencia_id, '900')
})
