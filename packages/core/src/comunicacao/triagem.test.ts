import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ehOptOut,
  normalizar,
  precisaEscalar,
  triarPorRegra,
  triagemSchema,
  type Triagem,
} from './triagem.ts'

const doModelo = (p: Partial<Triagem>): Triagem =>
  triagemSchema.parse({
    intencao: 'outro',
    sentimento: 'neutro',
    urgencia: 'baixa',
    pedido_de_humano: false,
    dados_extraidos: {},
    resumo_curto: '—',
    fonte: 'modelo',
    ...p,
  })

test('normalizar tira acento, pontuação e caixa', () => {
  assert.equal(normalizar('  NÃO Quero, receber!! '), 'nao quero receber')
})

test('opt-out inequívoco é resolvido sem chamar o modelo', () => {
  for (const texto of ['PARE', 'sair', 'Descadastrar', 'stop', 'não quero receber']) {
    const r = triarPorRegra({ corpo: texto })
    assert.equal(r?.intencao, 'recusa', texto)
    assert.equal(r?.fonte, 'regra')
  }
})

test('"não tenho interesse agora, me chama em março" NÃO é opt-out por regra', () => {
  // É o caso que a regex ingênua transformaria numa supressão irreversível.
  assert.equal(triarPorRegra({ corpo: 'Não tenho interesse agora, me chama em março que a gente conversa' }), null)
})

test('auto-resposta de ausência é resolvida por regra', () => {
  const r = triarPorRegra({ corpo: 'Automatic reply: estou de férias até 10/09, retorno em seguida.' })
  assert.equal(r?.intencao, 'operacional')
  assert.equal(r?.fonte, 'regra')
})

test('mídia sem texto tem triagem própria e não vai ao modelo', () => {
  const r = triarPorRegra({ corpo: '', temMidia: true })
  assert.equal(r?.resumo_curto, 'Enviou mídia sem texto.')
})

test('mensagem comum vai para o modelo', () => {
  assert.equal(triarPorRegra({ corpo: 'Bom dia, como funciona a antecipação de vocês?' }), null)
})

test('opt-out do modelo exige a palavra explícita no corpo', () => {
  const recusa = doModelo({ intencao: 'recusa' })
  assert.equal(ehOptOut(recusa, 'não me mande mais nada por favor'), true)
  // Recusa sem pedido de descadastro é "não obrigado", e não vira supressão.
  assert.equal(ehOptOut(recusa, 'não obrigado, já resolvemos isso internamente'), false)
  assert.equal(ehOptOut(doModelo({ intencao: 'adiar' }), 'me chama em março'), false)
})

test('opt-out vindo da regra é opt-out sem segunda checagem', () => {
  const porRegra = triarPorRegra({ corpo: 'PARE' })!
  assert.equal(ehOptOut(porRegra, 'PARE'), true)
})

test('taxa, preço e prazo escalam para humano', () => {
  const neutra = doModelo({ intencao: 'duvida' })
  assert.equal(precisaEscalar(neutra, 'qual a taxa de vocês?').escalar, true)
  assert.equal(precisaEscalar(neutra, 'quanto custa isso?').escalar, true)
  assert.equal(precisaEscalar(neutra, 'qual o prazo do contrato?').escalar, true)
})

test('"você é um robô?" escala — e a resposta não é negar', () => {
  const r = precisaEscalar(doModelo({ intencao: 'duvida' }), 'isso aí é um robô falando comigo?')
  assert.equal(r.escalar, true)
  assert.ok(r.motivo?.includes('robo'))
})

test('reclamação, negociação e pedido de humano escalam', () => {
  assert.equal(precisaEscalar(doModelo({ intencao: 'reclamacao' }), 'péssimo').escalar, true)
  assert.equal(precisaEscalar(doModelo({ intencao: 'negociacao' }), 'vamos negociar').escalar, true)
  assert.equal(precisaEscalar(doModelo({ pedido_de_humano: true }), 'oi').escalar, true)
})

test('irritação urgente escala mesmo sem palavra-chave', () => {
  const r = precisaEscalar(doModelo({ sentimento: 'negativo', urgencia: 'alta' }), 'isso é um absurdo')
  assert.equal(r.escalar, true)
})

test('uma dúvida tranquila não escala', () => {
  assert.equal(precisaEscalar(doModelo({ intencao: 'duvida' }), 'como funciona?').escalar, false)
})

test('o zod recusa uma intenção que o modelo inventou', () => {
  assert.throws(() =>
    triagemSchema.parse({
      intencao: 'talvez',
      sentimento: 'neutro',
      urgencia: 'baixa',
      pedido_de_humano: false,
      resumo_curto: 'x',
    }),
  )
})
