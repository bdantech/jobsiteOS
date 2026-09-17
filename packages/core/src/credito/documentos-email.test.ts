import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ASSUNTO_PADRAO,
  agruparAnexos,
  ehEmailValido,
  enderecoCompleto,
  lerEmailDocumentos,
  montarAssunto,
  montarCorpo,
  normalizarDestinatarios,
  type DadosDoEmailDocumentos,
} from './documentos-email.ts'

const DADOS: DadosDoEmailDocumentos = {
  cnpj: '07843489000102',
  razao_social: 'PLANGEFF ENGENHARIA LTDA',
  case_id: 'COV-99',
  limite_solicitado: 400_000,
  moeda: 'BRL',
  referencia: 'c7915e34-af2a-4ea1-8ae8-1e7c34ec46d7',
  documentos: [
    { tipo: 'balanco_patrimonial', rotulo: 'Balanço patrimonial', nome_arquivo: 'bp-2025.pdf' },
    { tipo: 'dre', rotulo: 'DRE', nome_arquivo: 'dre-2025.pdf' },
  ],
}

// ─── Destinatários ──────────────────────────────────────────────────────────

test('endereço sem arroba, sem domínio ou em branco não vira destinatário', () => {
  assert.equal(ehEmailValido('analista@atradius.com.br'), true)
  assert.equal(ehEmailValido('analista'), false)
  assert.equal(ehEmailValido('analista@atradius'), false)
  assert.equal(ehEmailValido('  '), false)
  assert.equal(ehEmailValido(null), false)
})

test('o mesmo endereço em caixas diferentes entra uma vez só', () => {
  const r = normalizarDestinatarios([
    { email: 'Analista@Atradius.com.br', nome: 'Analista' },
    { email: 'analista@atradius.com.br', nome: 'Outro nome' },
  ])
  assert.equal(r.length, 1)
  // Vence o PRIMEIRO: é o que a pessoa vê no topo da lista da tela.
  assert.equal(r[0]?.nome, 'Analista')
})

test('a lista aceita string solta, e o inválido cai fora sem derrubar o resto', () => {
  const r = normalizarDestinatarios(['a@b.com', 'lixo', { email: 'c@d.com' }, null, 42])
  assert.deepEqual(r.map((d) => d.email), ['a@b.com', 'c@d.com'])
})

test('configuração ausente não é erro: é lista vazia, e lista vazia não manda nada', () => {
  assert.deepEqual(lerEmailDocumentos(null).destinatarios, [])
  assert.deepEqual(lerEmailDocumentos({ destinatarios: 'nada disso' }).destinatarios, [])
  assert.equal(lerEmailDocumentos({ responder_para: 'nao-e-email' }).responder_para, null)
})

test('nome com vírgula vai entre aspas — sem elas o cabeçalho inventa um destinatário', () => {
  assert.equal(
    enderecoCompleto({ email: 'a@b.com', nome: 'Silva, João' }),
    '"Silva, João" <a@b.com>',
  )
  assert.equal(enderecoCompleto({ email: 'a@b.com', nome: null }), 'a@b.com')
})

// ─── Tamanho ────────────────────────────────────────────────────────────────

test('o que cabe junto vai num e-mail só', () => {
  const r = agruparAnexos([{ id: 'a', bytes: 10 }, { id: 'b', bytes: 20 }], 100)
  assert.equal(r.lotes.length, 1)
  assert.equal(r.recusados.length, 0)
})

test('estourando o teto, o excedente vai num segundo e-mail — não é descartado', () => {
  const r = agruparAnexos([{ id: 'a', bytes: 60 }, { id: 'b', bytes: 60 }], 100)
  assert.deepEqual(r.lotes.map((l) => l.map((d) => d.id)), [['a'], ['b']])
  assert.equal(r.recusados.length, 0)
})

test('a ordem da pasta é preservada, mesmo quando encher melhor seria possível', () => {
  // 60 + 30 caberiam juntos se a gente reordenasse. Não reordenamos.
  const r = agruparAnexos([{ id: 'a', bytes: 60 }, { id: 'b', bytes: 60 }, { id: 'c', bytes: 30 }], 100)
  assert.deepEqual(r.lotes.map((l) => l.map((d) => d.id)), [['a'], ['b', 'c']])
})

test('arquivo que sozinho estoura o teto é recusado com o motivo, e o resto vai', () => {
  const r = agruparAnexos([{ id: 'gigante', bytes: 300 }, { id: 'ok', bytes: 10 }], 100)
  assert.deepEqual(r.lotes.map((l) => l.map((d) => d.id)), [['ok']])
  assert.equal(r.recusados.length, 1)
  assert.match(r.recusados[0]?.motivo ?? '', /limite por e-mail/)
})

test('nenhum documento não inventa um lote vazio', () => {
  assert.deepEqual(agruparAnexos([], 100).lotes, [])
})

// ─── Texto ──────────────────────────────────────────────────────────────────

test('o assunto começa pelo CNPJ formatado, que é como a seguradora indexa o buyer', () => {
  const a = montarAssunto(null, DADOS)
  assert.match(a, /^Documentos — 07\.843\.489\/0001-02 PLANGEFF ENGENHARIA LTDA — pedido COV-99$/)
})

test('template próprio vence o padrão, e os marcadores valem nele também', () => {
  assert.equal(montarAssunto('Ref {referencia} — {cnpj}', DADOS), `Ref ${DADOS.referencia} — 07.843.489/0001-02`)
})

test('marcador sem valor não deixa espaço duplo nem traço solto no fim', () => {
  const a = montarAssunto(ASSUNTO_PADRAO, { ...DADOS, razao_social: null, case_id: null })
  assert.equal(a, 'Documentos — 07.843.489/0001-02 — pedido sem número')
  assert.doesNotMatch(a, /\s{2,}/)
})

test('em duas partes, o assunto diz qual é qual — senão a segunda parece repetição', () => {
  assert.match(montarAssunto(null, { ...DADOS, parte: 2, de: 2 }), /\(2\/2\)$/)
  // Parte 1 de 1 não ganha sufixo: "(1/1)" só levanta a pergunta de onde está a outra.
  assert.doesNotMatch(montarAssunto(null, { ...DADOS, parte: 1, de: 1 }), /\(/)
})

test('o corpo carrega CNPJ, pedido e a nossa referência — é por eles que o e-mail casa com a análise', () => {
  const c = montarCorpo(DADOS)
  assert.match(c, /CNPJ: 07\.843\.489\/0001-02/)
  assert.match(c, /Pedido na Atradius: COV-99/)
  assert.match(c, new RegExp(`Nossa referência: ${DADOS.referencia}`))
  assert.match(c, /Limite solicitado: R\$\s?400\.000,00/)
  assert.match(c, /- Balanço patrimonial: bp-2025\.pdf/)
})

test('sem case_id e sem limite, o corpo omite as linhas em vez de mentir um valor', () => {
  const c = montarCorpo({ ...DADOS, case_id: null, limite_solicitado: null })
  assert.doesNotMatch(c, /Pedido na Atradius/)
  assert.doesNotMatch(c, /Limite solicitado/)
  assert.match(c, /CNPJ: 07\.843\.489\/0001-02/)
})

test('moeda desconhecida não derruba o corpo — o número continua lá', () => {
  const c = montarCorpo({ ...DADOS, moeda: 'XYZ' })
  assert.match(c, /400\.000/)
})

test('documento sem rótulo do catálogo cai no tipo, e não em branco', () => {
  const c = montarCorpo({
    ...DADOS,
    documentos: [{ tipo: 'sped_ecd', rotulo: null, nome_arquivo: 'sped.txt' }],
  })
  assert.match(c, /- sped_ecd: sped\.txt/)
})
