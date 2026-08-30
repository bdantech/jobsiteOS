import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  dominioDoEmail,
  dominioIdentificaEmpresa,
  identificadorCanonico,
  paraE164Brasil,
  previewDe,
} from './identificador.ts'

test('o mesmo celular escrito de seis jeitos vira uma thread só', () => {
  const formas = [
    '+55 (11) 99999-8888',
    '55 11 99999 8888',
    '5511999998888',
    ' 5511999998888 ',
    '+5511999998888',
    '55-11-99999-8888',
  ]
  const canonicos = new Set(formas.map((f) => identificadorCanonico('whatsapp', f)))
  assert.equal(canonicos.size, 1)
  assert.equal([...canonicos][0], '5511999998888')
})

test('e-mail é minúsculo e sem espaço em volta', () => {
  assert.equal(identificadorCanonico('email', '  Joao.Silva@Empresa.COM.br '), 'joao.silva@empresa.com.br')
})

test('vazio e nulo não viram identificador', () => {
  assert.equal(identificadorCanonico('whatsapp', '   '), null)
  assert.equal(identificadorCanonico('whatsapp', null), null)
  assert.equal(identificadorCanonico('email', ''), null)
  // Um telefone que só tem pontuação não é um telefone.
  assert.equal(identificadorCanonico('whatsapp', '(  ) -'), null)
})

test('o DDI é acrescentado por tamanho, nunca por adivinhação', () => {
  assert.equal(paraE164Brasil('(11) 99999-8888'), '5511999998888') // 11 dígitos
  assert.equal(paraE164Brasil('(11) 3333-4444'), '551133334444') // 10 dígitos
  assert.equal(paraE164Brasil('5511999998888'), '5511999998888') // já tem DDI
  // Número que não entendemos volta como está: inventar 55 aqui mandaria
  // mensagem para um desconhecido.
  assert.equal(paraE164Brasil('12345'), '12345')
  assert.equal(paraE164Brasil('351912345678'), '351912345678')
})

test('domínio genérico não identifica empresa', () => {
  assert.equal(dominioDoEmail('alguem@gmail.com'), 'gmail.com')
  assert.equal(dominioIdentificaEmpresa('gmail.com'), false)
  assert.equal(dominioIdentificaEmpresa('construtoraxyz.com.br'), true)
  assert.equal(dominioIdentificaEmpresa(null), false)
  assert.equal(dominioDoEmail('não é e-mail'), null)
})

test('preview cabe numa linha e não corta no meio de nada visível', () => {
  assert.equal(previewDe('  linha um\n\nlinha  dois '), 'linha um linha dois')
  assert.equal(previewDe(null), null)
  const longo = 'a'.repeat(300)
  const p = previewDe(longo, 20)
  assert.equal(p?.length, 20)
  assert.ok(p?.endsWith('…'))
})
