import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extrairNotas, normalizarNfPayload, totalDePaginas, type RespostaNf } from './nf-payload.ts'

/**
 * O fixture é o payload REAL do endpoint, colado inteiro.
 *
 * A primeira versão do sync leu `value`, `issuedAt` e `xml` — os campos são
 * `amount`, `issueDate` e `rawXml`. Nada disso quebra typecheck: os três viram
 * `undefined`, a nota é descartada por "sem valor" e o sync termina com HTTP 200
 * e zero notas. Este arquivo existe para que renomear um campo lá quebre aqui.
 */
const RESPOSTA: RespostaNf = {
  data: [
    {
      id: 'NFe-12345',
      type: 'NFe',
      direction: 'received',
      number: '8821',
      series: '1',
      accessKey: '35260712345678000190550010000088211000088219',
      amount: 15230.55,
      issueDate: '2026-07-23T10:15:00',
      dueDate: '2026-08-22',
      status: 'sincronizado',
      syncedAt: '2026-07-24T11:02:31Z',
      recipient: {
        name: 'CONSTRUTORA EXEMPLO LTDA',
        taxId: '12345678000190',
        registered: true,
        contact: { name: 'Maria Silva', email: 'maria@exemplo.com', phone: '11999990000' },
      },
      supplier: {
        name: 'FORNECEDOR EXEMPLO SA',
        taxId: '98765432000110',
        registered: false,
        contact: null,
      },
      creditAnalysis: {
        status: 'APPROVED',
        role: 'DRAWEE',
        viaHeadquarters: false,
        analyzedTaxId: '12345678000190',
        creditLimit: 500000,
        availableLimit: 350000,
        consumedLimit: 150000,
        expirationDate: '2026-12-31',
        monthlyRateD0: 1.9,
        monthlyRateD1: 2.1,
      },
      rawXml: '<nfeProc ...>…</nfeProc>',
    },
  ],
  page: 1,
  pageSize: 50,
  total: 504,
  totalPages: 11,
  period: { startDate: '2026-07-23', endDate: '2026-07-24' },
}

const HOJE = new Date('2026-07-27T12:00:00Z')

function primeira() {
  const [item] = extrairNotas(RESPOSTA)
  assert.ok(item)
  const r = normalizarNfPayload(item, HOJE)
  assert.ok(r.ok, r.ok ? '' : `descartada por ${r.motivo}`)
  return r.nota
}

// ─── O envelope ─────────────────────────────────────────────────────────────

test('extrai as notas de `data` e o total de páginas', () => {
  assert.equal(extrairNotas(RESPOSTA).length, 1)
  assert.equal(totalDePaginas(RESPOSTA), 11)
})

// ─── Os três campos que a primeira versão errou ─────────────────────────────

test('o valor vem de `amount`', () => {
  assert.equal(primeira().valor, 15230.55)
})

test('a emissão vem de `issueDate`, e o horário não vaza para a data', () => {
  assert.equal(primeira().emitida_em, '2026-07-23T10:15:00')
})

test('o XML vem de `rawXml` e é guardado', () => {
  assert.equal(primeira().raw_xml, '<nfeProc ...>…</nfeProc>')
})

test('um payload sem os campos reais é DESCARTADO, não gravado com valor zero', () => {
  // Era exatamente este o sintoma do bug: 200, zero nota, nenhum erro.
  const r = normalizarNfPayload(
    { accessKey: '3'.repeat(44), recipient: { taxId: '12345678000190' }, supplier: { taxId: '98765432000110' } },
    HOJE,
  )
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.motivo, 'sem_valor')
})

// ─── Identidade e participantes ─────────────────────────────────────────────

test('mapeia chave, número, série, tipo e direção', () => {
  const n = primeira()
  assert.equal(n.access_key, '35260712345678000190550010000088211000088219')
  assert.equal(n.nf_id_externo, 'NFe-12345')
  assert.equal(n.numero, '8821')
  assert.equal(n.serie, '1')
  assert.equal(n.tipo, 'NFe')
  assert.equal(n.direction, 'received')
  assert.equal(n.status_sync, 'sincronizado')
})

test('sacado e fornecedor, com CNPJ normalizado e flag de cadastro', () => {
  const n = primeira()
  assert.equal(n.sacado_cnpj, '12345678000190')
  assert.equal(n.sacado_nome, 'CONSTRUTORA EXEMPLO LTDA')
  assert.equal(n.sacado_cadastrado, true)
  assert.equal(n.fornecedor_cnpj, '98765432000110')
  assert.equal(n.fornecedor_nome, 'FORNECEDOR EXEMPLO SA')
  assert.equal(n.fornecedor_cadastrado, false)
})

test('o contato do sacado é preservado', () => {
  assert.deepEqual(primeira().contato_sacado, {
    name: 'Maria Silva',
    email: 'maria@exemplo.com',
    phone: '11999990000',
  })
})

test('o contato do FORNECEDOR é preservado quando existe', () => {
  // O fornecedor é a unidade de abordagem: este contato é o que a outbox procura
  // antes de descartar por `sem_contato`. Descartá-lo aqui seria jogar fora o
  // dado que o módulo mais precisa.
  assert.equal(primeira().contato_fornecedor, null, 'neste fixture o supplier.contact é null')

  const [item] = extrairNotas(RESPOSTA)
  assert.ok(item)
  const comContato = normalizarNfPayload(
    { ...item, supplier: { ...item.supplier, contact: { name: 'João', email: 'joao@forn.com' } } },
    HOJE,
  )
  assert.ok(comContato.ok)
  assert.deepEqual(comContato.ok && comContato.nota.contato_fornecedor, {
    name: 'João',
    email: 'joao@forn.com',
  })
})

// ─── Vencimento e a sua origem ──────────────────────────────────────────────

test('sem parcelas no XML, o vencimento vem do endpoint e a origem diz isso', () => {
  const n = primeira()
  assert.equal(n.vencimento, '2026-08-22')
  assert.equal(n.vencimento_origem, 'endpoint')
})

test('com parcelas no XML, o XML ganha do endpoint', () => {
  const [item] = extrairNotas(RESPOSTA)
  assert.ok(item)
  const xml = `<infNFe Id="NFe${'3'.repeat(44)}"><cobr>
      <dup><nDup>001</nDup><dVenc>2026-09-30</dVenc><vDup>15230.55</vDup></dup>
    </cobr></infNFe>`
  const r = normalizarNfPayload({ ...item, rawXml: xml }, HOJE)
  assert.ok(r.ok)
  assert.equal(r.ok && r.nota.vencimento, '2026-09-30')
  assert.equal(r.ok && r.nota.vencimento_origem, 'xml')
  assert.equal(r.ok && r.nota.parcelas.length, 1)
})

test('sem vencimento em lugar nenhum, estima emissão + 30 dias e MARCA como estimado', () => {
  const [item] = extrairNotas(RESPOSTA)
  assert.ok(item)
  const r = normalizarNfPayload({ ...item, dueDate: null, rawXml: null }, HOJE)
  assert.ok(r.ok)
  assert.equal(r.ok && r.nota.vencimento, '2026-08-22') // 23/07 + 30
  assert.equal(r.ok && r.nota.vencimento_origem, 'estimado')
})

// ─── Crédito e sincronização ────────────────────────────────────────────────

test('a análise de crédito é preservada inteira, inclusive analyzedTaxId', () => {
  const c = primeira().credito
  assert.equal(c?.status, 'APPROVED')
  assert.equal(c?.monthlyRateD0, 1.9)
  assert.equal(c?.availableLimit, 350000)
  assert.equal(c?.analyzedTaxId, '12345678000190')
  assert.equal(c?.viaHeadquarters, false)
})

test('sincronizada_em usa o carimbo do lado de lá, não o now()', () => {
  // Com now(), 60 dias de nota antiga chegariam todos com o mesmo instante da
  // recuperação, e "quando esta nota entrou" viraria uma pergunta sem resposta.
  assert.equal(primeira().sincronizada_em, '2026-07-24T11:02:31Z')
})

test('sem syncedAt, cai no relógio local', () => {
  const [item] = extrairNotas(RESPOSTA)
  assert.ok(item)
  const r = normalizarNfPayload({ ...item, syncedAt: null }, HOJE)
  assert.ok(r.ok)
  assert.equal(r.ok && r.nota.sincronizada_em, HOJE.toISOString())
})

// ─── Tolerância ─────────────────────────────────────────────────────────────

test('o XML supre o que o JSON não trouxer', () => {
  const xml = `<infNFe Id="NFe35260712345678000190550010000088211000088219">
      <ide><nNF>8821</nNF><serie>1</serie><dhEmi>2026-07-23T10:15:00-03:00</dhEmi></ide>
      <emit><CNPJ>98765432000110</CNPJ></emit>
      <dest><CNPJ>12345678000190</CNPJ></dest>
      <total><ICMSTot><vNF>15230.55</vNF></ICMSTot></total>
    </infNFe>`
  const r = normalizarNfPayload({ rawXml: xml }, HOJE)
  assert.ok(r.ok, 'um payload só com XML ainda produz uma nota')
  if (!r.ok) return
  assert.equal(r.nota.access_key, '35260712345678000190550010000088211000088219')
  assert.equal(r.nota.valor, 15230.55)
  assert.equal(r.nota.numero, '8821')
  assert.equal(r.nota.fornecedor_cnpj, '98765432000110')
  assert.equal(r.nota.sacado_cnpj, '12345678000190')
})

test('XML ilegível não descarta a nota — registra o erro e segue', () => {
  const [item] = extrairNotas(RESPOSTA)
  assert.ok(item)
  const r = normalizarNfPayload({ ...item, rawXml: '' }, HOJE)
  assert.ok(r.ok)
  assert.equal(r.ok && r.nota.xml_parse_erro, 'XML ausente.')
  assert.equal(r.ok && r.nota.valor, 15230.55, 'o valor veio do JSON e a nota entra')
})

test('CNPJ pontuado é normalizado para 14 dígitos', () => {
  const [item] = extrairNotas(RESPOSTA)
  assert.ok(item)
  const r = normalizarNfPayload(
    { ...item, recipient: { ...item.recipient, taxId: '12.345.678/0001-90' } },
    HOJE,
  )
  assert.ok(r.ok)
  assert.equal(r.ok && r.nota.sacado_cnpj, '12345678000190')
})
