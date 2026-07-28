import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ORIGEM_NF,
  decidirContato,
  ehCelular,
  normalizarContatoNf,
  normalizarTelefone,
  type ContatoExistente,
} from './contato-nf.ts'

/**
 * Este job roda seis vezes por dia, para sempre, sobre a base de contatos inteira.
 * O que estes testes protegem não é a normalização — é a IDEMPOTÊNCIA e o respeito
 * à curadoria. Um bug aqui não derruba nada: ele apaga silenciosamente o telefone
 * que alguém corrigiu à mão, e ninguém descobre até a ligação cair.
 */

// ─── Normalização ───────────────────────────────────────────────────────────

test('telefone vira só dígitos e perde o 55', () => {
  assert.equal(normalizarTelefone('+55 (11) 99999-0000'), '11999990000')
  assert.equal(normalizarTelefone('11999990000'), '11999990000')
  assert.equal(normalizarTelefone('(11) 3333-4444'), '1133334444')
})

test('o mesmo número em duas formas normaliza para a MESMA string', () => {
  // É disto que depende a supressão: se "+5511..." e "11..." convivessem na base,
  // alguém que pediu para não ser contatado continuaria recebendo pela outra forma.
  assert.equal(normalizarTelefone('+5511999990000'), normalizarTelefone('(11) 99999-0000'))
})

test('número fora do formato brasileiro é descartado, não guardado pela metade', () => {
  assert.equal(normalizarTelefone('999990000'), null) // sem DDD
  assert.equal(normalizarTelefone('123'), null)
  assert.equal(normalizarTelefone(''), null)
  assert.equal(normalizarTelefone(null), null)
})

test('celular exige 11 dígitos com o nono na frente', () => {
  assert.ok(ehCelular('11999990000'))
  assert.ok(!ehCelular('1133334444')) // fixo
  assert.ok(!ehCelular(null))
})

test('e-mail inválido não vira contato', () => {
  assert.equal(normalizarContatoNf({ name: 'Maria', email: 'maria arroba exemplo', phone: null }), null)
  assert.equal(normalizarContatoNf({ name: 'Maria', email: 'MARIA@EXEMPLO.COM' })?.email, 'maria@exemplo.com')
})

test('nome sozinho NÃO é contato', () => {
  // Sem canal não há abordagem — a linha só engordaria a lista da ficha.
  assert.equal(normalizarContatoNf({ name: 'Maria Silva' }), null)
  assert.equal(normalizarContatoNf(null), null)
})

test('whatsapp só é preenchido quando o número é celular', () => {
  assert.equal(normalizarContatoNf({ phone: '11999990000' })?.whatsapp, '11999990000')
  // Fixo no campo whatsapp faria a Outbox escolhê-lo para o canal e a mensagem
  // morreria sem erro visível.
  assert.equal(normalizarContatoNf({ phone: '1133334444' })?.whatsapp, null)
})

// ─── A decisão ──────────────────────────────────────────────────────────────

const maria = normalizarContatoNf({
  name: 'Maria Silva',
  email: 'maria@exemplo.com',
  phone: '11999990000',
})!

test('empresa sem contato nenhum: insere', () => {
  const d = decidirContato(maria, [])
  assert.equal(d.acao, 'inserir')
})

test('rodar de novo com o mesmo dado não faz nada', () => {
  // A garantia central: 6 syncs por dia × todo dia não podem gerar 2.190 linhas.
  const existente: ContatoExistente = { id: 'c1', ...maria, origem: ORIGEM_NF }
  const d = decidirContato(maria, [existente])
  assert.equal(d.acao, 'nada')
})

test('contato da NF incompleto é COMPLETADO, não duplicado', () => {
  const existente: ContatoExistente = {
    id: 'c1',
    nome: null,
    email: 'maria@exemplo.com',
    telefone: null,
    whatsapp: null,
    origem: ORIGEM_NF,
  }
  const d = decidirContato(maria, [existente])
  assert.equal(d.acao, 'completar')
  assert.deepEqual(d.acao === 'completar' ? d.campos : null, {
    nome: 'Maria Silva',
    telefone: '11999990000',
    whatsapp: '11999990000',
  })
})

test('o que já está preenchido NUNCA é sobrescrito', () => {
  // Alguém corrigiu o nome à mão numa linha que o sync criou. O sync de amanhã
  // não pode desfazer isso.
  const existente: ContatoExistente = {
    id: 'c1',
    nome: 'Maria S. Oliveira (compras)',
    email: 'maria@exemplo.com',
    telefone: '1133334444',
    whatsapp: null,
    origem: ORIGEM_NF,
  }
  const d = decidirContato(maria, [existente])
  assert.equal(d.acao, 'completar')
  // Só o whatsapp, que estava vazio. Nome e telefone ficam como estão.
  assert.deepEqual(d.acao === 'completar' ? d.campos : null, { whatsapp: '11999990000' })
})

test('contato do Apollo é intocável', () => {
  const existente: ContatoExistente = {
    id: 'c1',
    nome: 'Maria Silva',
    email: 'maria@exemplo.com',
    telefone: null,
    whatsapp: null,
    origem: 'apollo',
  }
  const d = decidirContato(maria, [existente])
  assert.equal(d.acao, 'nada')
  assert.match(d.acao === 'nada' ? d.motivo : '', /apollo/)
})

test('contato digitado por uma pessoa é intocável', () => {
  const existente: ContatoExistente = {
    id: 'c1',
    nome: 'Maria',
    email: null,
    telefone: '11999990000',
    whatsapp: null,
    origem: null,
  }
  const d = decidirContato(maria, [existente])
  assert.equal(d.acao, 'nada')
})

test('casa por telefone mesmo quando o e-mail mudou', () => {
  // A pessoa trocou de e-mail; é a mesma pessoa. Inserir criaria um duplicado que
  // a ficha mostraria como dois contatos.
  const existente: ContatoExistente = {
    id: 'c1',
    nome: null,
    email: 'maria.antiga@exemplo.com',
    telefone: '11999990000',
    whatsapp: null,
    origem: ORIGEM_NF,
  }
  const d = decidirContato(maria, [existente])
  assert.equal(d.acao, 'completar')
  // O e-mail antigo permanece: preenchido não se sobrescreve, nem quando o novo
  // parece mais recente. Quem decide qual é o certo é uma pessoa.
  assert.equal(d.acao === 'completar' ? d.campos.email : 'x', undefined)
})

test('casa por telefone formatado de outro jeito na base', () => {
  const existente: ContatoExistente = {
    id: 'c1',
    nome: null,
    email: null,
    telefone: '+55 (11) 99999-0000',
    whatsapp: null,
    origem: ORIGEM_NF,
  }
  assert.equal(decidirContato(maria, [existente]).acao, 'completar')
})

test('pessoa diferente na mesma empresa vira contato novo', () => {
  const existente: ContatoExistente = {
    id: 'c1',
    nome: 'João',
    email: 'joao@exemplo.com',
    telefone: '11888880000',
    whatsapp: null,
    origem: ORIGEM_NF,
  }
  assert.equal(decidirContato(maria, [existente]).acao, 'inserir')
})
