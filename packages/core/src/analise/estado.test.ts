import assert from 'node:assert/strict'
import { test } from 'node:test'
import { estadoDaJanela, estadoDaLigacao, fecharJanela } from './estado.ts'
import { montarConfigQualidade } from './tipos.ts'

const agora = new Date('2026-10-05T20:00:00Z')
const msg = (h: number) => ({ criado_em: new Date(agora.getTime() - h * 3_600_000).toISOString() })

test('janela: conversa parada não gera análise nova', () => {
  const r = fecharJanela({ mensagensDesde: [msg(50), msg(49), msg(48), msg(47)], ultimaJanelaFim: msg(47).criado_em, agora, minMensagens: 4, horasSilencio: 12 })
  assert.equal(r, null)
})

test('janela: abaixo do mínimo de mensagens não fecha', () => {
  assert.equal(fecharJanela({ mensagensDesde: [msg(30), msg(29)], ultimaJanelaFim: null, agora, minMensagens: 4, horasSilencio: 12 }), null)
})

test('janela: conversa acontecendo agora espera o silêncio', () => {
  assert.equal(fecharJanela({ mensagensDesde: [msg(5), msg(4), msg(3), msg(1)], ultimaJanelaFim: null, agora, minMensagens: 4, horasSilencio: 12 }), null)
})

test('janela: fecha do fim da última até a última mensagem nova', () => {
  const anterior = msg(40).criado_em
  const r = fecharJanela({ mensagensDesde: [msg(41), msg(30), msg(28), msg(26), msg(24)], ultimaJanelaFim: anterior, agora, minMensagens: 4, horasSilencio: 12 })
  assert.deepEqual(r, { inicio: anterior, fim: msg(24).criado_em, mensagens: 4 })
})

test('estado da janela marca quem fala e quando, e a IA como IA', () => {
  const t = estadoDaJanela(
    [
      { direcao: 'entrada', canal: 'whatsapp', corpo: 'Qual a taxa?', assunto: null, criado_em: '2026-10-01T13:00:00Z', por_ia: false, autor: null },
      { direcao: 'saida', canal: 'whatsapp', corpo: 'Te mando hoje.', assunto: null, criado_em: '2026-10-01T13:05:00Z', por_ia: true, autor: 'Ana' },
    ],
    'Carla',
  )
  assert.equal(t, '[01/10, 10:00] Carla: Qual a taxa?\n[01/10, 10:05] Vendedor (IA) — Ana: Te mando hoje.')
})

test('estado da ligação lê os formatos de turno conhecidos', () => {
  assert.equal(
    estadoDaLigacao([{ quem: 'ana', texto: 'Oi' }, { speaker: 'user', text: 'Pode falar' }, { role: 'assistant', content: '' }]),
    'Vendedor (IA): Oi\nCliente: Pode falar',
  )
  assert.equal(estadoDaLigacao(null), '')
})

test('config: cada chave cai no padrão sozinha', () => {
  const c = montarConfigQualidade([
    { chave: 'calibracao', valor: { f1_minimo: 0.8 } },
    { chave: 'classificacao', valor: { delta: 9 } }, // inválido: volta ao padrão inteiro
  ])
  assert.equal(c.calibracao.f1_minimo, 0.8)
  assert.equal(c.calibracao.min_amostras_calibracao, 20)
  assert.equal(c.classificacao.delta, 0.1)
  assert.equal(c.captura.ligada, false)
})
