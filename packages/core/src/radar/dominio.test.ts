import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  dominioDeEmail,
  ehDominioDeContabilidade,
  motivoDescarteDominio,
  normalizarDominio,
  sugerirDominiosPorContato,
} from './dominio.ts'

// ─── normalizarDominio ──────────────────────────────────────────────────────

test('normalizar tira esquema, caminho, porta e caixa', () => {
  assert.equal(normalizarDominio('HTTPS://Acme.com.BR/contato?x=1'), 'acme.com.br')
  assert.equal(normalizarDominio('acme.com.br:8080'), 'acme.com.br')
  assert.equal(normalizarDominio('  acme.com.br.  '), 'acme.com.br')
})

test('normalizar tira o www — é ele que quebra a consulta do Apollo em silêncio', () => {
  assert.equal(normalizarDominio('www.7lm.com.br'), '7lm.com.br')
  assert.equal(normalizarDominio('WWW.7LM.COM.BR'), '7lm.com.br')
  // `wwwacme.com.br` não tem prefixo nenhum: o ponto é obrigatório.
  assert.equal(normalizarDominio('wwwacme.com.br'), 'wwwacme.com.br')
})

test('o que não é host vira null, não vira lixo normalizado', () => {
  assert.equal(normalizarDominio('localhost'), null) // sem ponto não é domínio público
  assert.equal(normalizarDominio('não é domínio'), null)
  assert.equal(normalizarDominio(''), null)
  assert.equal(normalizarDominio(null), null)
})

// ─── dominioDeEmail ─────────────────────────────────────────────────────────

test('e-mail corporativo devolve o host', () => {
  assert.equal(dominioDeEmail('Fulano@Acme.com.br'), 'acme.com.br')
})

test('provedor genérico devolve null — inclusive nas variantes .com.br', () => {
  assert.equal(dominioDeEmail('fulano@gmail.com'), null)
  assert.equal(dominioDeEmail('fulano@hotmail.com.br'), null)
  assert.equal(dominioDeEmail('fulano@outlook.com'), null)
})

/** A comparação por raiz é o que faz `gmail.com.br` cair — e o que quase derruba isto. */
test('subdomínio corporativo não é confundido com provedor genérico', () => {
  assert.equal(dominioDeEmail('joao@mail.construtora.com.br'), 'mail.construtora.com.br')
  assert.equal(dominioDeEmail('joao@ig.empreiteira.com.br'), 'ig.empreiteira.com.br')
  assert.equal(dominioDeEmail('joao@mail.com'), null)
})

test('e-mail malformado devolve null em vez de inventar domínio', () => {
  assert.equal(dominioDeEmail('fulano'), null)
  assert.equal(dominioDeEmail('a@b@c.com'), null)
  assert.equal(dominioDeEmail('fulano@'), null)
})

// ─── Contabilidade ──────────────────────────────────────────────────────────
//
// O caso que motivou tudo: a contabilidade abre a empresa e cadastra o próprio e-mail
// na Receita. O domínio existe, responde, tem MX — só é de outra empresa. Validar mais
// forte nunca resolveria; só o NOME denuncia.

test('domínio de escritório contábil é descartado', () => {
  assert.equal(dominioDeEmail('fiscal@contabilmaestro.com.br'), null)
  assert.equal(dominioDeEmail('joao@ca-contadores.com.br'), null)
  assert.equal(dominioDeEmail('x@assessoriacontabilsilva.com.br'), null)
  assert.equal(dominioDeEmail('x@contabsc.com.br'), null)
})

test('.cnt.br cai sempre: o registro.br só concede a contabilista com CRC', () => {
  assert.equal(dominioDeEmail('contato@escritaonline.cnt.br'), null)
  assert.equal(ehDominioDeContabilidade('qualquercoisa.cnt.br'), true)
})

/**
 * O motivo de `cont` sozinho estar FORA da lista. Estas quatro são construtoras reais,
 * medidas no dump da Receita — um token mais curto apagaria o domínio certo delas para
 * pegar alguns escritórios a mais.
 */
test('construtora que começa com "cont" NÃO é confundida com contabilidade', () => {
  assert.equal(dominioDeEmail('obra@contextoengenharia.com'), 'contextoengenharia.com')
  assert.equal(dominioDeEmail('obra@contrutoraf5.com.br'), 'contrutoraf5.com.br')
  assert.equal(dominioDeEmail('obra@contagas.com.br'), 'contagas.com.br')
  assert.equal(dominioDeEmail('obra@controlsegsistemas.com.br'), 'controlsegsistemas.com.br')
})

test('erros de digitação de provedor não viram domínio corporativo', () => {
  // Sem isto o domínio gravado é um host que não existe: o DNS falha e o
  // enriquecimento devolve "sem dados" para sempre, como se a empresa fosse obscura.
  assert.equal(dominioDeEmail('fulano@gmai.com'), null)
  assert.equal(dominioDeEmail('fulano@gamil.com'), null)
  assert.equal(dominioDeEmail('fulano@hotmai.com'), null)
})

test('placeholder de formulário é descartado', () => {
  assert.equal(dominioDeEmail('contato@contato.com.br'), null)
  assert.equal(dominioDeEmail('a@xxx.com.br'), null)
  // Mas um subdomínio de verdade sobrevive: são quatro rótulos, não um placeholder.
  assert.equal(dominioDeEmail('a@contato.construtora.com.br'), 'contato.construtora.com.br')
})

test('o motivo do descarte é dito, não só o null', () => {
  assert.equal(motivoDescarteDominio('gmail.com'), 'provedor_generico')
  assert.equal(motivoDescarteDominio('contato.com.br'), 'placeholder')
  assert.equal(motivoDescarteDominio('contabilmaestro.com.br'), 'contabilidade')
  assert.equal(motivoDescarteDominio('acme.com.br'), null)
})

// ─── sugerirDominiosPorContato ──────────────────────────────────────────────

test('empresa sem domínio salvo cujo contato tem e-mail corporativo: caso ausente', () => {
  const r = sugerirDominiosPorContato(
    [{ empresaId: 'e1', email: 'joao@acme.com.br' }],
    [{ id: 'e1', dominio: null }],
  )
  assert.equal(r.length, 1)
  assert.equal(r[0]!.caso, 'ausente')
  assert.equal(r[0]!.sugerido, 'acme.com.br')
  assert.equal(r[0]!.contatosNoAtual, 0)
})

test('o domínio salvo já é o que os contatos usam: silêncio', () => {
  const r = sugerirDominiosPorContato(
    [{ empresaId: 'e1', email: 'joao@acme.com.br' }],
    [{ id: 'e1', dominio: 'acme.com.br' }],
  )
  assert.deepEqual(r, [])
})

/**
 * O caso que sumiria se a comparação fosse feita já normalizada — e continuaria
 * quebrando o enriquecimento de headcount sem ninguém ver.
 */
test('www no salvo é MALFORMADO, não some da lista por ser "o mesmo domínio"', () => {
  const r = sugerirDominiosPorContato(
    [{ empresaId: 'e1', email: 'joao@7lm.com.br' }],
    [{ id: 'e1', dominio: 'www.7lm.com.br' }],
  )
  assert.equal(r.length, 1)
  assert.equal(r[0]!.caso, 'malformado')
  assert.equal(r[0]!.dominioAtual, 'www.7lm.com.br') // cru, para a tela mostrar o defeito
  assert.equal(r[0]!.sugerido, '7lm.com.br')
})

test('domínios realmente diferentes: divergente', () => {
  const r = sugerirDominiosPorContato(
    [{ empresaId: 'e1', email: 'joao@vemmorarmais.com.br' }],
    [{ id: 'e1', dominio: 'construtoracapital.com.br' }],
  )
  assert.equal(r[0]!.caso, 'divergente')
  assert.equal(r[0]!.contatosNoAtual, 0)
})

test('vence o domínio com mais contatos; o empate é alfabético (determinístico)', () => {
  const r = sugerirDominiosPorContato(
    [
      { empresaId: 'e1', email: 'a@beta.com.br' },
      { empresaId: 'e1', email: 'b@alfa.com.br' },
      { empresaId: 'e1', email: 'c@alfa.com.br' },
    ],
    [{ id: 'e1', dominio: null }],
  )
  assert.equal(r[0]!.sugerido, 'alfa.com.br')
  assert.equal(r[0]!.contatosSugerido, 2)
  assert.deepEqual(r[0]!.candidatos.map((c) => c.dominio), ['alfa.com.br', 'beta.com.br'])
})

test('e-mails genéricos não fabricam sugestão nenhuma', () => {
  const r = sugerirDominiosPorContato(
    [
      { empresaId: 'e1', email: 'joao@gmail.com' },
      { empresaId: 'e1', email: null },
    ],
    [{ id: 'e1', dominio: null }],
  )
  assert.deepEqual(r, [])
})

/** Minoria não derruba maioria: o salvo continua sendo o mais usado. */
test('um contato num domínio estranho não sugere trocar o domínio da empresa', () => {
  const r = sugerirDominiosPorContato(
    [
      { empresaId: 'e1', email: 'a@acme.com.br' },
      { empresaId: 'e1', email: 'b@acme.com.br' },
      { empresaId: 'e1', email: 'c@fornecedor.com.br' },
    ],
    [{ id: 'e1', dominio: 'acme.com.br' }],
  )
  assert.deepEqual(r, [])
})
