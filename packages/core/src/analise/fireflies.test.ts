import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import {
  assinaturaFirefliesConfere,
  chaveIdempotencia,
  estadoResgate,
  iguaisTempoConstante,
  lerConferenciaChave,
  lerWebhookFireflies,
  normalizarLinkReuniao,
  normalizarTranscricao,
} from './fireflies.ts'

const SEGREDO = 'segredo-de-teste'
const CORPO = '{"event":"meeting.transcribed","timestamp":1710876543210,"meeting_id":"ASxwZxCstx","client_reference_id":"be582c46"}'
const assinar = (corpo: string, s = SEGREDO) => `sha256=${createHmac('sha256', s).update(corpo).digest('hex')}`

test('HMAC sobre o corpo cru confere', async () => {
  assert.equal(await assinaturaFirefliesConfere(SEGREDO, CORPO, assinar(CORPO)), true)
})

test('o mesmo JSON reserializado NÃO confere — a assinatura é do corpo cru', async () => {
  const reserializado = JSON.stringify(JSON.parse(CORPO), null, 1)
  assert.equal(await assinaturaFirefliesConfere(SEGREDO, reserializado, assinar(CORPO)), false)
})

test('segredo errado, cabeçalho ausente, malformado ou sem segredo configurado: falha fechado', async () => {
  assert.equal(await assinaturaFirefliesConfere(SEGREDO, CORPO, assinar(CORPO, 'outro')), false)
  assert.equal(await assinaturaFirefliesConfere(SEGREDO, CORPO, null), false)
  assert.equal(await assinaturaFirefliesConfere(SEGREDO, CORPO, 'sha256=xyz'), false)
  assert.equal(await assinaturaFirefliesConfere('', CORPO, assinar(CORPO)), false)
})

test('comparação em tempo constante não para no primeiro caractere diferente — e ainda acerta', () => {
  assert.equal(iguaisTempoConstante('abc', 'abc'), true)
  assert.equal(iguaisTempoConstante('abc', 'abd'), false)
  assert.equal(iguaisTempoConstante('abc', 'abcd'), false)
})

test('evento conhecido e idempotência por (evento, meeting_id)', () => {
  const w = lerWebhookFireflies(JSON.parse(CORPO))
  assert.equal(w.conhecido, true)
  assert.equal(w.client_reference_id, 'be582c46')
  assert.equal(chaveIdempotencia(w), 'meeting.transcribed:ASxwZxCstx')
  const outro = lerWebhookFireflies({ event: 'meeting.summarized', meeting_id: 'ASxwZxCstx' })
  assert.notEqual(chaveIdempotencia(outro), chaveIdempotencia(w))
})

test('evento desconhecido é lido (para ser registrado), não descartado', () => {
  const w = lerWebhookFireflies({ event: 'meeting.deleted', meeting_id: 'Q1' })
  assert.equal(w.conhecido, false)
  assert.equal(w.evento, 'meeting.deleted')
  assert.equal(chaveIdempotencia(w), 'meeting.deleted:Q1')
  // corpo sem nada reconhecível também vira registro
  assert.equal(lerWebhookFireflies('lixo').evento, '')
})

test('formato antigo (eventType/meetingId) ainda é lido', () => {
  const w = lerWebhookFireflies({ eventType: 'Transcription completed', meetingId: 'M9', clientReferenceId: 'r' })
  assert.equal(w.meeting_id, 'M9')
  assert.equal(w.conhecido, false)
})

test('rate limit do addToLiveMeeting: 3 em 20 minutos, e a hora da próxima vaga', () => {
  const agora = new Date('2026-10-05T14:00:00Z')
  const min = (m: number) => new Date(agora.getTime() - m * 60_000)
  assert.deepEqual(estadoResgate([], agora), { disponivel: true, usados: 0, proximo_em: null })
  assert.equal(estadoResgate([min(15), min(5)], agora).disponivel, true)
  const cheio = estadoResgate([min(15), min(10), min(2)], agora)
  assert.equal(cheio.disponivel, false)
  assert.equal(cheio.proximo_em!.toISOString(), '2026-10-05T14:05:00.000Z') // a de 15 min atrás sai em 5
  // a que já saiu da janela não conta
  assert.equal(estadoResgate([min(25), min(10), min(2)], agora).disponivel, true)
})

test('transcrição: falas consecutivas viram parágrafo; participantes com e-mail e quem falou', () => {
  const t = normalizarTranscricao({
    id: 'M1',
    title: 'Reunião — Alfa',
    duration: 32.5,
    transcript_url: 'https://app.fireflies.ai/view/M1',
    cal_id: 'abc123@google.com',
    meeting_link: 'https://meet.google.com/xyz-abcd-efg?authuser=0',
    meeting_attendees: [
      { displayName: 'Rodrigo', email: 'Rodrigo@OnePay.com.br' },
      { displayName: 'Carla Alfa', email: 'carla@alfa.com.br' },
      { displayName: null, email: 'admin@oneos.com.br' },
    ],
    sentences: [
      { speaker_name: 'Rodrigo', text: 'Bom dia.', start_time: 0, end_time: 1 },
      { speaker_name: 'Rodrigo', text: 'Como está o caixa?', start_time: 1, end_time: 3 },
      { speaker_name: 'Carla Alfa', text: 'Apertado, o prazo do cliente é 90 dias.', start_time: 3, end_time: 7 },
      { speaker_name: 'Desconhecido', text: 'Oi.', start_time: 7, end_time: 8 },
    ],
    summary: { overview: 'Conversa sobre prazo.', action_items: '**Rodrigo**\n- Enviar proposta até sexta\n- Ligar para a Carla' },
  })
  assert.equal(t.texto, 'Rodrigo: Bom dia. Como está o caixa?\nCarla Alfa: Apertado, o prazo do cliente é 90 dias.\nDesconhecido: Oi.')
  assert.equal(t.duracao_s, 1950)
  assert.deepEqual(t.proximos_passos, ['Enviar proposta até sexta', 'Ligar para a Carla'])
  assert.equal(t.participantes.find((p) => p.email === 'carla@alfa.com.br')!.falou, true)
  assert.equal(t.participantes.find((p) => p.email === 'admin@oneos.com.br')!.falou, false)
  assert.ok(t.participantes.some((p) => p.nome === 'Desconhecido' && p.falou))
  assert.equal(normalizarLinkReuniao(t.meeting_link), 'meet.google.com/xyz-abcd-efg')
})

test('chave recusada: o Fireflies responde 500 com auth_failed, e isso é recusa, não instabilidade', () => {
  const corpo = { errors: [{ friendly: true, code: 'auth_failed', extensions: { code: 'auth_failed' } }] }
  assert.equal(lerConferenciaChave(500, corpo).valida, false)
  assert.equal(lerConferenciaChave(401, {}).valida, false)
})

test('chave aceita devolve o e-mail do dono, para a tela mostrar de que conta ela é', () => {
  assert.deepEqual(lerConferenciaChave(200, { data: { user: { email: 'admin@oneos.com.br', name: 'Admin' } } }), {
    valida: true,
    email: 'admin@oneos.com.br',
  })
})

test('fora do ar ou resposta estranha não recusa: não dá para saber', () => {
  assert.equal(lerConferenciaChave(502, null).valida, null)
  assert.equal(lerConferenciaChave(500, { errors: [{ code: 'internal_server_error' }] }).valida, null)
})
