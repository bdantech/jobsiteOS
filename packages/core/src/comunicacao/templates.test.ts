import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  primeiroNome,
  renderizarMensagem,
  variaveisDesconhecidasDoTemplate,
  variaveisDoTemplate,
} from './templates.ts'

test('as variáveis usadas saem do próprio corpo, ordenadas e sem repetição', () => {
  assert.deepEqual(
    variaveisDoTemplate('Olá {contato_nome}, a {empresa_nome} tem notas. Abraço, {contato_nome}.'),
    ['contato_nome', 'empresa_nome'],
  )
})

test('uma chave fora do catálogo é apontada antes de salvar', () => {
  assert.deepEqual(variaveisDesconhecidasDoTemplate('Oi {contato_nome}, {taxa_do_dia}'), ['taxa_do_dia'])
  assert.deepEqual(variaveisDesconhecidasDoTemplate('Oi {contato_nome}'), [])
})

test('o primeiro nome é o que se usa no WhatsApp', () => {
  assert.equal(primeiroNome('José Ricardo da Silva Neto'), 'José')
  assert.equal(primeiroNome('  Ana  '), 'Ana')
  assert.equal(primeiroNome(null), '')
})

test('e-mail sem aceite explícito ganha o link de descadastro', () => {
  const t = 'Olá {contato_nome}!'
  const corpo = renderizarMensagem(t, { contato_nome: 'Ana' }, {
    canal: 'email',
    baseLegal: 'dado_publico_nfe',
    linkDescadastro: 'https://oneos.com.br/sair/abc',
  })
  assert.ok(corpo.startsWith('Olá Ana!'))
  assert.ok(corpo.includes('https://oneos.com.br/sair/abc'))
})

test('e-mail com aceite em formulário não leva descadastro anexado', () => {
  const corpo = renderizarMensagem('Olá {contato_nome}!', { contato_nome: 'Ana' }, {
    canal: 'email',
    baseLegal: 'formulario_aceite',
    linkDescadastro: 'https://oneos.com.br/sair/abc',
  })
  assert.equal(corpo, 'Olá Ana!')
})

test('WhatsApp nunca leva link de descadastro anexado', () => {
  const corpo = renderizarMensagem('Olá {contato_nome}!', { contato_nome: 'Ana' }, {
    canal: 'whatsapp',
    baseLegal: 'dado_publico_nfe',
    linkDescadastro: 'https://oneos.com.br/sair/abc',
  })
  assert.equal(corpo, 'Olá Ana!')
})

test('chave sem valor sobrevive à renderização, para o erro ser visto no preview', () => {
  const corpo = renderizarMensagem('Olá {contato_nome}, {inexistente}', { contato_nome: 'Ana' }, {
    canal: 'whatsapp',
    baseLegal: 'relacao_comercial',
  })
  assert.equal(corpo, 'Olá Ana, {inexistente}')
})
