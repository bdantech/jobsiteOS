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
  estagio_funil: 'a_prospectar',
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
  estagio_funil: 'a_prospectar',
  perda_motivo: null,
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
  estagio_funil: 'a_prospectar',
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

/**
 * 24/09/2026: a oferta antecipada ficava escondida atrás da nota, e a nota seguia em
 * `a_prospectar` — o SDR via na coluna aberta um recebível que o fornecedor já
 * tinha pedido para antecipar.
 */
test('oferta ANTECIPADA atrás de NF aberta encerra a nota como convertida', () => {
  const r = deduplicarFunil({
    ...VAZIO,
    notas: [nf()],
    preAutorizacoes: [pre({ estagio_funil: 'convertida', antecipacao_id_externo: 7788 })],
  })

  assert.equal(r.ocultacoes.length, 1, 'a oferta segue escondida atrás da nota')
  assert.deepEqual(r.encerramentos, [
    {
      tipo: 'nf',
      referencia_id: '3'.repeat(44),
      estagio: 'convertida',
      perda_motivo: null,
      conversao_antecipacao_id: 7788,
    },
  ])
})

for (const estagio of ['perdida', 'expirada'] as const) {
  test(`oferta ${estagio} atrás de NF aberta NÃO encerra a nota — ela segue sendo trabalho`, () => {
    const r = deduplicarFunil({
      ...VAZIO,
      notas: [nf()],
      preAutorizacoes: [pre({ estagio_funil: estagio })],
    })
    assert.deepEqual(r.encerramentos, [])
    assert.equal(r.selos.length, 1)
  })
}

test('as duas metades antecipadas encerram a nota UMA vez', () => {
  const r = deduplicarFunil({
    ...VAZIO,
    notas: [nf()],
    preAutorizacoes: [
      pre({ id_externo: 501, valor: 5_000, estagio_funil: 'convertida' }),
      pre({ id_externo: 502, valor: 5_000, estagio_funil: 'convertida' }),
    ],
  })
  assert.equal(r.encerramentos.length, 1)
  assert.equal(r.ocultacoes.length, 2)
})

test('nota já convertida segura a oferta convertida — Encerradas não mostra o recebível duas vezes', () => {
  const r = deduplicarFunil({
    ...VAZIO,
    notas: [nf({ estagio_funil: 'convertida' })],
    preAutorizacoes: [pre({ estagio_funil: 'convertida' })],
  })
  assert.equal(r.ocultacoes.length, 1)
  assert.deepEqual(r.encerramentos, [], 'já está encerrada, não reescreve')
})

test('nota encerrada NÃO esconde oferta aberta — a outra metade vira card próprio', () => {
  const r = deduplicarFunil({
    ...VAZIO,
    notas: [nf({ estagio_funil: 'convertida' })],
    preAutorizacoes: [pre({ estagio_funil: 'a_prospectar' })],
  })
  assert.deepEqual(r.ocultacoes, [])
  assert.deepEqual(r.selos, [])
})

test('nota encerrada nesta passada não é escondida pela parcela', () => {
  const chave = '3'.repeat(44)
  const r = deduplicarFunil(
    {
      notas: [nf({ access_key: chave })],
      preAutorizacoes: [pre({ estagio_funil: 'convertida' })],
      titulos: [titulo({ bill_access_key: chave })],
    },
    'titulo',
  )
  assert.equal(r.encerramentos[0]?.tipo, 'nf')
  assert.equal(r.ocultacoes.find((o) => o.tipo === 'nf'), undefined)
})

test('pré-auth ↔ título: a OFERTA fica e a parcela sai — o par é 1:1', () => {
  const r = deduplicarFunil({
    ...VAZIO,
    preAutorizacoes: [pre({ numero_normalizado: null })],
    titulos: [titulo({ pre_autorizacao_id_externo: 501 })],
  })

  assert.deepEqual(r.ocultacoes, [
    {
      tipo: 'titulo',
      referencia_id: '900',
      motivo: 'oferta_criada',
      original_tipo: 'pre_autorizacao',
      original_id: '501',
    },
  ])
  // A oferta É o card: não há selo "já tem pré-autorização" para pousar em ninguém.
  assert.deepEqual(r.selos, [])
  assert.deepEqual(r.encerramentos, [])
})

test('casa pela PARCELA (billId + installmentId) quando o título não aponta', () => {
  const r = deduplicarFunil({
    ...VAZIO,
    preAutorizacoes: [
      pre({ numero_normalizado: null, sienge_bill_id: 4242, sienge_installment_id: 1 }),
    ],
    titulos: [titulo()],
  })

  assert.equal(r.ocultacoes.length, 1)
  assert.equal(r.ocultacoes[0]?.tipo, 'titulo')
  assert.equal(r.ocultacoes[0]?.original_id, '501')
})

/**
 * A decisão de 23/09/2026, e ela é de negócio: oferta recusada não é parcela a
 * retrabalhar. Sem o encerramento a parcela voltaria como prospecção nova no dia
 * seguinte e o funil pediria de novo o trabalho que a construtora já respondeu.
 */
for (const estagio of ['perdida', 'expirada', 'convertida'] as const) {
  test(`oferta ${estagio} ENCERRA a parcela, não devolve ela à coluna aberta`, () => {
    const r = deduplicarFunil({
      ...VAZIO,
      preAutorizacoes: [pre({ numero_normalizado: null, estagio_funil: estagio })],
      titulos: [titulo({ pre_autorizacao_id_externo: 501, estagio_funil: 'a_prospectar' })],
    })

    assert.equal(r.ocultacoes.length, 1, 'a parcela continua escondida atrás da oferta')
    assert.equal(r.encerramentos.length, 1)
    assert.equal(r.encerramentos[0]?.referencia_id, '900')
    assert.equal(r.encerramentos[0]?.estagio, estagio)
    // `convertida` não é perda: não inventa motivo de perda.
    assert.equal(r.encerramentos[0]?.perda_motivo === null, estagio === 'convertida')
  })
}

test('o motivo de perda da oferta descesse para a parcela quando existe', () => {
  const r = deduplicarFunil({
    ...VAZIO,
    preAutorizacoes: [
      pre({
        numero_normalizado: null,
        estagio_funil: 'perdida',
        perda_motivo: 'Revogada pela construtora.',
      }),
    ],
    titulos: [titulo({ pre_autorizacao_id_externo: 501 })],
  })

  assert.equal(r.encerramentos[0]?.perda_motivo, 'Revogada pela construtora.')
})

/**
 * O ciclo que o `continue` do §2a existe para impedir: parcela → oferta → NF →
 * parcela. Se a oferta pudesse ser escondida pela NF depois de já ter escondido a
 * parcela, `raiz()` daria a volta até o teto de saltos e devolveria um original
 * arbitrário — e o card visível seria decidido por acidente.
 */
test('oferta com parcela é a RAIZ: a NF não a esconde, e não há ciclo', () => {
  const chave = '3'.repeat(44)
  const r = deduplicarFunil(
    {
      notas: [nf({ access_key: chave })],
      // A mesma oferta casa com a parcela (por id) E com a NF (por número).
      preAutorizacoes: [pre({ sienge_bill_id: 4242, sienge_installment_id: 1 })],
      titulos: [titulo({ bill_access_key: chave })],
    },
    'titulo',
  )

  assert.equal(
    r.ocultacoes.find((o) => o.tipo === 'pre_autorizacao'),
    undefined,
    'a oferta não é escondida por ninguém',
  )
  const daParcela = r.ocultacoes.find((o) => o.tipo === 'titulo')
  assert.equal(daParcela?.original_id, '501')
  // A NF é escondida, e a cadeia a reaponta para a OFERTA, que é quem está na tela.
  const daNota = r.ocultacoes.find((o) => o.tipo === 'nf')
  assert.equal(daNota?.original_tipo, 'pre_autorizacao')
  assert.equal(daNota?.original_id, '501')
})

/**
 * A 0254 no core: documento encerrado não leva card aberto com ele. Aqui a parcela
 * é encerrada NESTA MESMA passada pela oferta, então o estágio do banco ainda diz
 * `a_prospectar` — e é por isso que o teste existe.
 */
test('parcela encerrada pela oferta não esconde NF aberta', () => {
  const chave = '3'.repeat(44)
  const r = deduplicarFunil(
    {
      notas: [nf({ access_key: chave })],
      preAutorizacoes: [
        pre({
          numero_normalizado: null,
          estagio_funil: 'perdida',
          sienge_bill_id: 4242,
          sienge_installment_id: 1,
        }),
      ],
      titulos: [titulo({ bill_access_key: chave, estagio_funil: 'a_prospectar' })],
    },
    'titulo',
  )

  assert.equal(r.encerramentos.length, 1)
  assert.equal(
    r.ocultacoes.find((o) => o.tipo === 'nf'),
    undefined,
    'a NF aberta fica na tela; quem saiu foi a parcela, atrás da oferta perdida',
  )
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
