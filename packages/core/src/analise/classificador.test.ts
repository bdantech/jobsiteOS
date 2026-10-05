import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  lerClassificacaoClaude,
  lerRespostaJev,
  montarPedidoJev,
  perguntarComQueda,
  type Classificador,
  type PerguntaTipada,
  type RespostaCalibrada,
} from './classificador.ts'

const PERGUNTAS: PerguntaTipada[] = [
  { id: 'apl:conectou_a_dor', tipo: 'sim_nao', pergunta: 'O cliente verbalizou uma dor?' },
  { id: 'item:explorou_dor', tipo: 'sim_nao', pergunta: 'Explorou a dor?' },
  { id: 'item:objecao', tipo: 'escolha', pergunta: 'Qual objeção?', opcoes: ['preço', 'prazo', 'sem objeção'] },
]

function fixo(provedor: 'jev' | 'claude', fn: (ps: readonly PerguntaTipada[]) => RespostaCalibrada[] | Error): Classificador & { chamadas: string[][] } {
  const chamadas: string[][] = []
  return {
    provedor,
    chamadas,
    async perguntar(_estado, ps) {
      chamadas.push(ps.map((p) => p.id))
      const r = fn(ps)
      if (r instanceof Error) throw r
      return r
    },
  }
}

const sim = (id: string, p: number, provedor: 'jev' | 'claude'): RespostaCalibrada => ({
  id,
  resultado: p >= 0.5 ? 'sim' : 'nao',
  probabilidade: p,
  provedor,
})

test('Jev inteiro: nada cai para o Claude', async () => {
  const jev = fixo('jev', (ps) => ps.map((p) => sim(p.id, 0.8, 'jev')))
  const claude = fixo('claude', () => new Error('não devia ser chamado'))
  const r = await perguntarComQueda({ primario: jev, reserva: claude, estado: 'x', perguntas: PERGUNTAS })
  assert.equal(r.caiu, false)
  assert.equal(claude.chamadas.length, 0)
  assert.ok(r.respostas.every((x) => x.provedor === 'jev'))
})

test('Jev cai (erro/timeout): a mesma análise segue inteira no Claude, com provedor por item', async () => {
  const jev = fixo('jev', () => new Error('timeout'))
  const claude = fixo('claude', (ps) => ps.map((p) => sim(p.id, 0.7, 'claude')))
  const r = await perguntarComQueda({ primario: jev, reserva: claude, estado: 'x', perguntas: PERGUNTAS })
  assert.equal(r.caiu, true)
  assert.equal(r.erroPrimario, 'timeout')
  assert.equal(r.respostas.length, 3)
  assert.ok(r.respostas.every((x) => x.provedor === 'claude'))
})

test('Jev responde em parte: só as perguntas que faltaram vão ao Claude', async () => {
  const jev = fixo('jev', (ps) => [sim(ps[0]!.id, 0.9, 'jev')])
  const claude = fixo('claude', (ps) => ps.map((p) => sim(p.id, 0.6, 'claude')))
  const r = await perguntarComQueda({ primario: jev, reserva: claude, estado: 'x', perguntas: PERGUNTAS })
  assert.deepEqual(claude.chamadas, [['item:explorou_dor', 'item:objecao']])
  assert.equal(r.respostas.find((x) => x.id === 'apl:conectou_a_dor')!.provedor, 'jev')
  assert.equal(r.respostas.find((x) => x.id === 'item:explorou_dor')!.provedor, 'claude')
  assert.deepEqual(r.semResposta, [])
})

test('resposta inválida (probabilidade fora de [0,1], pergunta não feita) conta como não respondida', async () => {
  const jev = fixo('jev', () => [sim('apl:conectou_a_dor', 1.7, 'jev'), sim('item:inventada', 0.5, 'jev')])
  const claude = fixo('claude', (ps) => ps.map((p) => sim(p.id, 0.6, 'claude')))
  const r = await perguntarComQueda({ primario: jev, reserva: claude, estado: 'x', perguntas: PERGUNTAS })
  assert.equal(claude.chamadas[0]!.length, 3)
  assert.ok(!r.respostas.some((x) => x.id === 'item:inventada'))
})

test('os dois falham: lança, e a fila tenta de novo depois', async () => {
  const jev = fixo('jev', () => new Error('503'))
  const claude = fixo('claude', () => new Error('overloaded'))
  await assert.rejects(
    perguntarComQueda({ primario: jev, reserva: claude, estado: 'x', perguntas: PERGUNTAS }),
    /Os dois classificadores falharam: 503 \/ overloaded/,
  )
})

test('o reserva também incompleto: o que ninguém respondeu volta em semResposta', async () => {
  const jev = fixo('jev', () => new Error('caiu'))
  const claude = fixo('claude', (ps) => [sim(ps[0]!.id, 0.4, 'claude')])
  const r = await perguntarComQueda({ primario: jev, reserva: claude, estado: 'x', perguntas: PERGUNTAS })
  assert.deepEqual(r.semResposta, ['item:explorou_dor', 'item:objecao'])
})

test('pedido ao Jev: noul para sim/não, choice com critérios, ids sem caractere especial', () => {
  const p = montarPedidoJev('texto', PERGUNTAS)
  assert.equal(p.model, 'jev-latest')
  assert.equal(p.questions['apl_conectou_a_dor']!.type, 'noul')
  assert.deepEqual(p.questions['item_objecao']!.criteria, { preço: 'preço', prazo: 'prazo', 'sem objeção': 'sem objeção' })
})

test('resposta do Jev: P(sim) do noul, escolha com confiança, tokens de entrada', () => {
  const l = lerRespostaJev(PERGUNTAS, {
    model: 'jev-latest',
    answers: {
      apl_conectou_a_dor: { type: 'noul', noul: 0.74 },
      item_explorou_dor: { type: 'noul', noul: 0.31 },
      item_objecao: { type: 'choice', choice: 'prazo', confidence: 0.81, probabilities: { prazo: 0.81, preço: 0.1, 'sem objeção': 0.09 } },
    },
    usage: { input_tokens: 4210, output_tokens: 0 },
  })
  assert.equal(l.tokensEntrada, 4210)
  assert.deepEqual(
    l.respostas.map((r) => [r.id, r.resultado, r.probabilidade]),
    [
      ['apl:conectou_a_dor', 'sim', 0.74],
      ['item:explorou_dor', 'nao', 0.31],
      ['item:objecao', 'prazo', 0.81],
    ],
  )
})

test('Claude como classificador: "não" com 0,9 é lido como P(sim) = 0,1', () => {
  const r = lerClassificacaoClaude(PERGUNTAS, {
    respostas: [
      { id: 'item:explorou_dor', resposta: 'não', probabilidade: 0.9 },
      { id: 'apl:conectou_a_dor', resposta: 'sim', probabilidade: 0.8 },
      { id: 'item:objecao', resposta: 'Prazo', probabilidade: 0.7 },
    ],
  })
  const porId = new Map(r.map((x) => [x.id, x]))
  assert.equal(Math.round(porId.get('item:explorou_dor')!.probabilidade * 10) / 10, 0.1)
  assert.equal(porId.get('item:explorou_dor')!.resultado, 'nao')
  assert.equal(porId.get('apl:conectou_a_dor')!.probabilidade, 0.8)
  assert.equal(porId.get('item:objecao')!.resultado, 'prazo')
  assert.ok(r.every((x) => x.provedor === 'claude'))
})
