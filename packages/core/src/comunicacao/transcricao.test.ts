import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ehFalaVazia,
  lerConferenciaChaveElevenLabs,
  lerRespostaScribe,
  normalizarTermosChave,
  previewComTranscricao,
  recusaPorTermos,
  textoDaMensagem,
} from './transcricao.ts'

test('o modelo lê o rótulo do áudio e a fala entre aspas', () => {
  assert.equal(
    textoDaMensagem({ corpo: '(áudio · 12s)', transcricao: ' Não quero mais receber mensagem. ' }),
    '(áudio · 12s) «Não quero mais receber mensagem.»',
  )
})

test('sem transcrição, a mensagem é o que sempre foi', () => {
  assert.equal(textoDaMensagem({ corpo: '(áudio · 12s)', transcricao: null }), '(áudio · 12s)')
  assert.equal(textoDaMensagem({ corpo: 'Bom dia', transcricao: '' }), 'Bom dia')
  assert.equal(textoDaMensagem({ corpo: null, preview: 'prévia' }), 'prévia')
})

test('a prévia do inbox corta a fala longa e fecha as aspas', () => {
  const p = previewComTranscricao('(áudio · 40s)', 'palavra '.repeat(60), 60)
  assert.ok(p.length <= 60)
  assert.ok(p.startsWith('(áudio · 40s) «palavra'))
  assert.ok(p.endsWith('…»'))
})

test('resposta da ElevenLabs: texto, duração cobrada e idioma', () => {
  assert.deepEqual(
    lerRespostaScribe({ text: 'Oi,  tudo\nbem?', audio_duration_secs: 4.2, language_code: 'por', words: [] }),
    { texto: 'Oi, tudo bem?', segundos: 4.2, idioma: 'por' },
  )
  assert.equal(lerRespostaScribe({ transcripts: [] }), null)
  assert.equal(lerRespostaScribe(null), null)
})

test('barulho, pontuação e evento sonoro não são fala', () => {
  assert.equal(ehFalaVazia(''), true)
  assert.equal(ehFalaVazia('(risos) ...'), true)
  assert.equal(ehFalaVazia('Ok.'), false)
})

test('termos-chave: sem repetidos, sem os que a ElevenLabs recusaria', () => {
  assert.deepEqual(
    normalizarTermosChave(['OnePay', ' onepay ', 'pré-autorização', 'a'.repeat(50), 'um dois três quatro cinco seis', '']),
    ['OnePay', 'pré-autorização'],
  )
})

test('só recusa por causa dos termos quando a resposta fala deles', () => {
  assert.equal(recusaPorTermos(422, { detail: [{ loc: ['body', 'keyterms'], msg: 'invalid' }] }), true)
  assert.equal(recusaPorTermos(422, { detail: 'file too short' }), false)
  assert.equal(recusaPorTermos(500, { detail: 'keyterms' }), false)
})

test('chave da ElevenLabs: recusa só o que ela disse ser inválido', () => {
  assert.equal(lerConferenciaChaveElevenLabs(200, { subscription: {} }).valida, true)
  assert.equal(
    lerConferenciaChaveElevenLabs(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } }).valida,
    false,
  )
  // Chave restrita a speech-to-text não lê o usuário: não dá para saber, então não recusa.
  assert.equal(lerConferenciaChaveElevenLabs(401, { detail: { status: 'missing_permissions' } }).valida, null)
  assert.equal(lerConferenciaChaveElevenLabs(503, null).valida, null)
})
