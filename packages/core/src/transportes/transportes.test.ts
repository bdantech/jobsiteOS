import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deveIngerir,
  extrairEndereco,
  extrairNome,
  lerMensagemGmail,
  montarRfc822,
  semCitacao,
  type EmailRecebido,
} from './gmail.ts'
import { lerWebhookResend } from './resend.ts'
import {
  TransporteWasender,
  lerEnvioWasender,
  lerStatusWasender,
  lerWebhookWasender,
} from './wasender.ts'

// ─── Wasender ───────────────────────────────────────────────────────────────

test('número inválido é falha PERMANENTE, e não vira retry', async () => {
  const t = new TransporteWasender({
    baseUrl: 'https://wasender.test',
    token: 'segredo',
    numero: '5511999990000',
    fetchImpl: async () => {
      throw new Error('não deveria chamar a rede')
    },
  })
  const r = await t.enviar({ destino: '   ', corpo: 'oi' })
  assert.equal(r.ok, false)
  assert.equal(r.retryavel, false)
})

test('o envio devolve o id externo, que é a chave de idempotência', async () => {
  let recebido: { url: string; body: any } | null = null
  const t = new TransporteWasender({
    baseUrl: 'https://wasender.test/',
    token: 'segredo',
    numero: '5511999990000',
    fetchImpl: (async (url: string, init: any) => {
      recebido = { url, body: JSON.parse(init.body) }
      return new Response(JSON.stringify({ success: true, data: { msgId: 'abc123' } }), { status: 200 })
    }) as unknown as typeof fetch,
  })
  const r = await t.enviar({ destino: '(11) 99999-8888', corpo: 'olá' })
  assert.equal(r.ok, true)
  assert.equal(r.idExterno, 'abc123')
  assert.equal(recebido!.url, 'https://wasender.test/api/send-message')
  // O destino sai em E.164 sem "+", como o provedor espera.
  assert.equal(recebido!.body.to, '5511999998888')
})

test('429 é retryável e 400 não é', async () => {
  const cria = (status: number) =>
    new TransporteWasender({
      baseUrl: 'https://w.test',
      token: 't',
      numero: '55',
      fetchImpl: (async () => new Response(JSON.stringify({ message: 'x' }), { status })) as unknown as typeof fetch,
    })
  assert.equal((await cria(429).enviar({ destino: '11999998888', corpo: 'a' })).retryavel, true)
  assert.equal((await cria(500).enviar({ destino: '11999998888', corpo: 'a' })).retryavel, true)
  assert.equal((await cria(400).enviar({ destino: '11999998888', corpo: 'a' })).retryavel, false)
})

test('o webhook lê a mensagem de entrada e ignora grupo e eco', () => {
  const evento = {
    event: 'messages.upsert',
    sessionId: '5511333330000',
    data: {
      messages: {
        key: { remoteJid: '5511999998888@s.whatsapp.net', id: 'WAID1', fromMe: false },
        pushName: 'Marcelo Financeiro',
        message: { conversation: 'Bom dia, pode mandar sim' },
        messageTimestamp: 1756300000,
      },
    },
  }
  const m = lerWebhookWasender(evento)!
  assert.equal(m.idExterno, 'WAID1')
  assert.equal(m.de, '5511999998888')
  assert.equal(m.nomeSugerido, 'Marcelo Financeiro')
  assert.equal(m.corpo, 'Bom dia, pode mandar sim')
  assert.equal(m.temMidia, false)

  // Grupo: uma thread por grupo seria uma "pessoa" que é dezenas.
  const grupo = structuredClone(evento)
  grupo.data.messages.key.remoteJid = '123456@g.us'
  assert.equal(lerWebhookWasender(grupo), null)

  // Nossa própria mensagem voltando duplicaria a linha do ledger.
  const eco = structuredClone(evento)
  eco.data.messages.key.fromMe = true
  assert.equal(lerWebhookWasender(eco), null)
})

test('mídia sem legenda é reconhecida como mídia', () => {
  const m = lerWebhookWasender({
    event: 'messages.upsert',
    data: {
      messages: {
        key: { remoteJid: '5511999998888@s.whatsapp.net', id: 'W2' },
        message: { audioMessage: { seconds: 8 } },
      },
    },
  })!
  assert.equal(m.temMidia, true)
  assert.equal(m.corpo, null)
})

test('status de entrega vira status_envio', () => {
  assert.deepEqual(lerStatusWasender({ event: 'message.status', data: { id: 'X', status: 'delivered' } }), {
    idExterno: 'X',
    status: 'entregue',
  })
  assert.equal(lerStatusWasender({ event: 'messages.upsert', data: {} }), null)
})

// ─── Resend ─────────────────────────────────────────────────────────────────

test('hard bounce e reclamação viram SUPRESSÃO, não apenas status', () => {
  const bounce = lerWebhookResend({
    type: 'email.bounced',
    data: { email_id: 'e1', to: ['ninguem@empresa.com'], bounce: { type: 'Permanent' } },
  })
  assert.deepEqual(bounce, {
    tipo: 'supressao',
    idExterno: 'e1',
    email: 'ninguem@empresa.com',
    motivo: 'hard_bounce',
  })

  const spam = lerWebhookResend({ type: 'email.complained', data: { email_id: 'e2', to: ['a@b.com'] } })
  assert.equal(spam?.tipo, 'supressao')
})

test('soft bounce NÃO suprime — caixa cheia não é endereço inexistente', () => {
  const r = lerWebhookResend({
    type: 'email.bounced',
    data: { email_id: 'e3', to: ['a@b.com'], bounce: { type: 'SoftBounce' } },
  })
  assert.deepEqual(r, { tipo: 'status', idExterno: 'e3', status: 'falhou' })
})

test('entregue e aberto são só status', () => {
  assert.deepEqual(lerWebhookResend({ type: 'email.delivered', data: { email_id: 'e4' } }), {
    tipo: 'status',
    idExterno: 'e4',
    status: 'entregue',
  })
  assert.equal(lerWebhookResend({ type: 'email.delivery_delayed', data: { email_id: 'e5' } }), null)
})

// ─── Gmail ──────────────────────────────────────────────────────────────────

const universo = {
  emails: new Set(['contato@construtoraxyz.com.br']),
  dominios: new Set(['construtoraxyz.com.br']),
}

const email = (p: Partial<EmailRecebido>): EmailRecebido => ({
  idExterno: 'g1',
  threadExterna: 't1',
  messageId: '<m1@mail>',
  emRespostaA: null,
  de: 'alguem@fora.com',
  nomeSugerido: null,
  para: ['vendedor@oneos.com.br'],
  assunto: null,
  corpo: null,
  recebidoEm: new Date(),
  ...p,
})

test('a caixa pessoal inteira NÃO é ingerida', () => {
  assert.equal(deveIngerir(email({ de: 'mae@gmail.com', para: ['vendedor@oneos.com.br'] }), universo), false)
  assert.equal(deveIngerir(email({ de: 'newsletter@qualquercoisa.io' }), universo), false)
})

test('contato conhecido e domínio de empresa da base entram', () => {
  assert.equal(deveIngerir(email({ de: 'contato@construtoraxyz.com.br' }), universo), true)
  // Alguém NOVO da mesma empresa: é exatamente o caso do inbox de identificação.
  assert.equal(deveIngerir(email({ de: 'outro.setor@construtoraxyz.com.br' }), universo), true)
})

test('domínio genérico nunca casa, mesmo que um contato use gmail', () => {
  const comGmail = { emails: new Set(['pessoa@gmail.com']), dominios: new Set(['gmail.com']) }
  // O e-mail exato casa; o domínio genérico, não — senão a caixa inteira entraria.
  assert.equal(deveIngerir(email({ de: 'pessoa@gmail.com' }), comGmail), true)
  assert.equal(deveIngerir(email({ de: 'outra.pessoa@gmail.com' }), comGmail), false)
})

test('endereço e nome são extraídos do cabeçalho', () => {
  assert.equal(extrairEndereco('"Ana Souza" <Ana.Souza@Empresa.com>'), 'ana.souza@empresa.com')
  assert.equal(extrairNome('"Ana Souza" <ana@empresa.com>'), 'Ana Souza')
  assert.equal(extrairNome('ana@empresa.com'), null)
})

test('o corpo é achado dentro do multipart, preferindo texto puro', () => {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
  const m = lerMensagemGmail({
    id: 'G1',
    threadId: 'T1',
    internalDate: '1756300000000',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Ana <ana@construtoraxyz.com.br>' },
        { name: 'To', value: 'vendedor@oneos.com.br' },
        { name: 'Subject', value: 'Re: antecipação' },
        { name: 'Message-ID', value: '<abc@mail>' },
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/html', body: { data: b64('<p>ignorar</p>') } },
            { mimeType: 'text/plain', body: { data: b64('Pode mandar a simulação.') } },
          ],
        },
      ],
    },
  })!
  assert.equal(m.corpo, 'Pode mandar a simulação.')
  assert.equal(m.de, 'ana@construtoraxyz.com.br')
  assert.equal(m.nomeSugerido, 'Ana')
  assert.equal(m.messageId, '<abc@mail>')
})

test('a citação da resposta é cortada antes da triagem', () => {
  const corpo = [
    'Pode mandar sim.',
    '',
    'Em 27/08/2026, ONE OS escreveu:',
    '> Olá Ana, temos 3 notas disponíveis',
    '> Abraço',
  ].join('\n')
  assert.equal(semCitacao(corpo), 'Pode mandar sim.')
  assert.equal(semCitacao(null), null)
})

test('o RFC822 leva threading e assunto com acento codificado', () => {
  const raw = montarRfc822('Ana <ana@oneos.com.br>', {
    destino: 'cliente@x.com',
    assunto: 'Antecipação disponível',
    corpo: 'oi',
    emRespostaA: '<abc@mail>',
  })
  assert.ok(raw.includes('In-Reply-To: <abc@mail>'))
  assert.ok(raw.includes('References: <abc@mail>'))
  assert.ok(raw.includes('Subject: =?UTF-8?B?'))
  assert.ok(raw.includes('From: Ana <ana@oneos.com.br>'))
})

// ─── Endereçamento por LID (0162) ───────────────────────────────────────────

/*
 * O defeito que estes testes travam custou caro: TODA conversa recebida entrou na
 * base chaveada por um número que não existe (`98711384416410`), o que produziu
 * uma thread para o que entra e outra para o que sai da MESMA pessoa, deixou a
 * tela sem telefone para formatar e mandou todo mundo para a fila de
 * identificação.
 */
test('LID: o telefone vem de cleanedSenderPn, nunca do remoteJid', () => {
  const m = lerWebhookWasender({
    event: 'messages.received',
    sessionId: 'sessao-1',
    data: {
      messages: {
        key: {
          id: 'WLID1',
          fromMe: false,
          remoteJid: '98711384416410@lid',
          addressingMode: 'lid',
          senderPn: '5511999998888@s.whatsapp.net',
          cleanedSenderPn: '5511999998888',
          senderLid: '98711384416410@lid',
        },
        pushName: 'Prii',
        message: { conversation: 'oi' },
      },
    },
  })!
  assert.equal(m.de, '5511999998888')
  assert.equal(m.lid, '98711384416410')
  assert.equal(m.nomeSugerido, 'Prii')
})

test('LID sem telefone: a mensagem entra, chaveada pelo LID, para não se perder', () => {
  const m = lerWebhookWasender({
    event: 'messages.received',
    data: {
      messages: {
        key: { id: 'WLID2', fromMe: false, remoteJid: '2222222222222@lid' },
        message: { conversation: 'ping' },
      },
    },
  })!
  // `de === lid` é o sinal que o worker usa para procurar a thread pelo LID em
  // vez de abrir uma nova.
  assert.equal(m.de, '2222222222222')
  assert.equal(m.lid, '2222222222222')
})

test('sem telefone e sem LID não há a quem atribuir a mensagem', () => {
  assert.equal(
    lerWebhookWasender({
      event: 'messages.received',
      data: { messages: { key: { id: 'W0', fromMe: false, remoteJid: '' } } },
    }),
    null,
  )
})

// ─── O que sai pelo aparelho (0162) ─────────────────────────────────────────

test('message.sent é lido como SAÍDA — o inbox mostrava só metade do diálogo', () => {
  const e = lerEnvioWasender({
    event: 'message.sent',
    sessionId: 'sessao-1',
    data: {
      key: { id: 'WSENT1', fromMe: true, remoteJid: '5511999998888@s.whatsapp.net' },
      message: { conversation: 'Já respondi, pode deixar' },
      success: true,
    },
  })!
  assert.equal(e.idExterno, 'WSENT1')
  assert.equal(e.para, '5511999998888')
  assert.equal(e.corpo, 'Já respondi, pode deixar')
})

test('o destino também pode vir como LID, e aí quem vale é remoteJidAlt', () => {
  const e = lerEnvioWasender({
    event: 'message.sent',
    data: {
      key: {
        id: 'WSENT2',
        fromMe: true,
        remoteJid: '278472945594535@lid',
        remoteJidAlt: '5511988887777@s.whatsapp.net',
      },
      message: { conversation: 'ok' },
    },
  })!
  assert.equal(e.para, '5511988887777')
  assert.equal(e.lid, '278472945594535')
})

test('os dois leitores são excludentes: entrada não é saída e vice-versa', () => {
  const entrada = {
    event: 'messages.received',
    data: {
      messages: {
        key: { id: 'WX', fromMe: false, remoteJid: '5511999998888@s.whatsapp.net' },
        message: { conversation: 'oi' },
      },
    },
  }
  assert.notEqual(lerWebhookWasender(entrada), null)
  assert.equal(lerEnvioWasender(entrada), null)

  const saida = structuredClone(entrada) as any
  saida.data.messages.key.fromMe = true
  assert.equal(lerWebhookWasender(saida), null)
  assert.notEqual(lerEnvioWasender(saida), null)
})

test('grupo continua fora, inclusive no que sai', () => {
  assert.equal(
    lerEnvioWasender({
      event: 'message.sent',
      data: { key: { id: 'WG', fromMe: true, remoteJid: '123456@g.us' }, message: { conversation: 'x' } },
    }),
    null,
  )
})

test('o status de entrega não é confundido com uma mensagem', () => {
  const ack = { event: 'messages.update', data: { key: { id: 'WSENT1' }, status: 'read' } }
  assert.deepEqual(lerStatusWasender(ack), { idExterno: 'WSENT1', status: 'lida' })
})
