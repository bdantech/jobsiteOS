import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CalendarioGoogle,
  ESCOPO_CALENDAR,
  ESCOPOS_GOOGLE,
  classificarFalha,
  meetDaResposta,
  montarEventoGoogle,
  type ReuniaoParaGoogle,
} from './google-calendar.ts'

const BASE: ReuniaoParaGoogle = {
  id: '0f2b8d1e-5a4c-4c9a-9f3b-7e1d2c3b4a55',
  titulo: 'Reunião — ALIANCA MB CONSTRUTORA LTDA',
  inicioEm: new Date('2026-09-15T16:00:00.000Z'),
  duracaoMin: 60,
  modalidade: 'meet',
  convidados: [
    { email: 'Cliente@Construtora.com.br', nome: 'Ana', interno: false },
    { email: 'viktor.cireia@oneos.com.br', nome: 'Viktor', interno: true },
  ],
}

test('o fim do evento sai da duração, e o fuso é o nosso', () => {
  const e = montarEventoGoogle({ ...BASE, duracaoMin: 45 })
  assert.equal((e.start as { dateTime: string }).dateTime, '2026-09-15T16:00:00.000Z')
  assert.equal((e.end as { dateTime: string }).dateTime, '2026-09-15T16:45:00.000Z')
  assert.equal((e.start as { timeZone: string }).timeZone, 'America/Sao_Paulo')
})

test('modalidade meet pede a sala ao Google, com o id do evento como requestId', () => {
  const e = montarEventoGoogle(BASE)
  const conf = e.conferenceData as { createRequest: { requestId: string; conferenceSolutionKey: { type: string } } }
  assert.equal(conf.createRequest.requestId, BASE.id)
  assert.equal(conf.createRequest.conferenceSolutionKey.type, 'hangoutsMeet')
  // Nada de "Google Meet" no `location`: ele competiria com o botão de entrar.
  assert.equal(e.location, undefined)
})

test('presencial leva o endereço em location e não abre sala', () => {
  const e = montarEventoGoogle({ ...BASE, modalidade: 'presencial', local: 'Av. Faria Lima 3000' })
  assert.equal(e.location, 'Av. Faria Lima 3000')
  assert.equal(e.conferenceData, undefined)
})

test('modalidade a_definir não abre sala nem inventa local', () => {
  const e = montarEventoGoogle({ ...BASE, modalidade: 'a_definir', local: null })
  assert.equal(e.conferenceData, undefined)
  assert.equal(e.location, undefined)
})

test('convidado entra em minúsculas; quem não tem e-mail de verdade fica de fora', () => {
  const e = montarEventoGoogle({
    ...BASE,
    convidados: [...BASE.convidados, { email: 'nao-e-email', nome: 'Ruído' }],
  })
  const attendees = e.attendees as { email: string; displayName?: string }[]
  assert.deepEqual(
    attendees.map((a) => a.email),
    ['cliente@construtora.com.br', 'viktor.cireia@oneos.com.br'],
  )
})

test('o link do Meet é lido do entryPoint de vídeo e, na falta dele, do hangoutLink', () => {
  assert.equal(
    meetDaResposta({
      conferenceData: {
        entryPoints: [
          { entryPointType: 'phone', uri: 'tel:+55110000' },
          { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' },
        ],
      },
    }),
    'https://meet.google.com/abc-defg-hij',
  )
  assert.equal(
    meetDaResposta({ hangoutLink: 'https://meet.google.com/zzz-yyyy-xxx' }),
    'https://meet.google.com/zzz-yyyy-xxx',
  )
  assert.equal(meetDaResposta({}), null)
})

test('403 por escopo e 403 por cota são problemas opostos e não podem virar o mesmo texto', () => {
  const escopo = classificarFalha(403, {
    error: { message: 'Request had insufficient authentication scopes.' },
  })
  assert.equal(escopo.falha, 'escopo')
  assert.match(escopo.erro, /Reconecte/)

  const cota = classificarFalha(403, {
    error: { message: 'Rate Limit Exceeded', errors: [{ reason: 'rateLimitExceeded' }] },
  })
  assert.equal(cota.falha, 'transitoria')
})

test('401 pede token novo; 404 diz que o evento sumiu da agenda', () => {
  assert.equal(classificarFalha(401, {}).falha, 'token')
  assert.equal(classificarFalha(404, {}).falha, 'sumiu')
  assert.equal(classificarFalha(410, {}).falha, 'sumiu')
  assert.equal(classificarFalha(500, {}).falha, 'transitoria')
  assert.equal(classificarFalha(400, { error: { message: 'Invalid start time' } }).falha, 'permanente')
})

test('criar manda sendUpdates=all — é o que convida o cliente de fato', async () => {
  let urlVista = ''
  const calendario = new CalendarioGoogle({
    accessToken: 'tok',
    fetchImpl: (async (url: string) => {
      urlVista = url
      return new Response(
        JSON.stringify({ id: 'evt_1', hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc' }),
        { status: 200 },
      )
    }) as unknown as typeof fetch,
  })

  const r = await calendario.criar(BASE)
  assert.equal(r.ok, true)
  assert.equal(r.eventoId, 'evt_1')
  assert.equal(r.meetUrl, 'https://meet.google.com/aaa-bbbb-ccc')
  assert.match(urlVista, /sendUpdates=all/)
  assert.match(urlVista, /conferenceDataVersion=1/)
  assert.match(urlVista, /calendars\/primary\/events/)
})

test('cancelar um evento que já não existe lá é sucesso, não falha', async () => {
  const calendario = new CalendarioGoogle({
    accessToken: 'tok',
    fetchImpl: (async () => new Response('', { status: 410 })) as unknown as typeof fetch,
  })
  const r = await calendario.cancelar('evt_1')
  assert.equal(r.ok, true)
})

test('o consentimento pede a agenda junto com o Gmail', () => {
  assert.ok(ESCOPOS_GOOGLE.includes(ESCOPO_CALENDAR))
  assert.ok(ESCOPOS_GOOGLE.includes('https://www.googleapis.com/auth/gmail.send'))
})
