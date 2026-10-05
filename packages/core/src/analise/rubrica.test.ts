import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RespostaCalibrada } from './classificador.ts'
import {
  aplicarRevisao,
  calcularNota,
  decidirItens,
  explicarNota,
  perguntasDaRubrica,
  type ItemRubrica,
} from './rubrica.ts'

const P = { delta: 0.1, limiarAplicabilidade: 0.5, limiarPadrao: 0.5 }

function item(chave: string, extra: Partial<ItemRubrica> = {}): ItemRubrica {
  return {
    id: `id-${chave}`,
    chave,
    etapa: null,
    ordem: 0,
    rotulo: chave,
    pergunta: `${chave}?`,
    tipo_resposta: 'sim_nao',
    opcoes: null,
    peso: 1,
    condicao_aplicabilidade: null,
    limiar: 0.6,
    orientacao: `faça ${chave}`,
    atende: ['sim'],
    status_calibracao: 'publicado',
    gera_pendencia: null,
    ...extra,
  }
}

const r = (id: string, p: number): RespostaCalibrada => ({ id, resultado: p >= 0.5 ? 'sim' : 'nao', probabilidade: p, provedor: 'jev' })
const pesos = (itens: ItemRubrica[]) => new Map(itens.map((i) => [i.chave, i.peso]))

test('todos os itens inaplicáveis → score NULL, nunca zero', () => {
  const itens = [
    item('definiu_proximo_passo', { condicao_aplicabilidade: 'Terminou sem recusa?' }),
    item('tratou_objecao', { condicao_aplicabilidade: 'Houve objeção?' }),
  ]
  const d = decidirItens(itens, [r('apl:definiu_proximo_passo', 0.1), r('apl:tratou_objecao', 0.2), r('item:definiu_proximo_passo', 0.05)], P)
  assert.ok(d.every((x) => !x.aplicavel))
  const n = calcularNota(d, pesos(itens))
  assert.equal(n.score, null)
  assert.equal(n.itens_aplicaveis, 0)
  assert.equal(explicarNota(n, new Map()), 'Sem avaliação aplicável.')
})

test('item inaplicável sai do denominador: não conta como atendido nem como falho', () => {
  const itens = [item('a'), item('b'), item('c', { condicao_aplicabilidade: 'Aplica?' })]
  const d = decidirItens(itens, [r('item:a', 0.9), r('item:b', 0.1), r('apl:c', 0.2), r('item:c', 0.0)], P)
  const n = calcularNota(d, pesos(itens))
  assert.equal(n.itens_aplicaveis, 2)
  assert.equal(n.itens_atendidos, 1)
  assert.equal(n.score, 0.5)
})

test('peso zero: grava, não mexe na nota; só pesos zero → NULL', () => {
  const itens = [item('a', { peso: 2 }), item('b', { peso: 0 })]
  const d = decidirItens(itens, [r('item:a', 0.9), r('item:b', 0.1)], P)
  assert.equal(calcularNota(d, pesos(itens)).score, 1)
  const soZero = [item('z', { peso: 0 })]
  assert.equal(calcularNota(decidirItens(soZero, [r('item:z', 0.9)], P), pesos(soZero)).score, null)
})

test('rubrica sem itens ativos → NULL e nenhuma pergunta', () => {
  assert.deepEqual(perguntasDaRubrica([]), [])
  assert.equal(calcularNota(decidirItens([], [], P), new Map()).score, null)
})

test('a nota é ponderada: Σ(peso × atendido) / Σ(peso)', () => {
  const itens = [item('a', { peso: 3 }), item('b', { peso: 1 })]
  const d = decidirItens(itens, [r('item:a', 0.9), r('item:b', 0.2)], P)
  assert.equal(calcularNota(d, pesos(itens)).score, 0.75)
})

test('pergunta negativa: "ficou pergunta sem resposta?" é atendido quando o NÃO é provável', () => {
  const itens = [item('respondeu_pergunta', { atende: ['nao'] })]
  const d = decidirItens(itens, [r('item:respondeu_pergunta', 0.1)], P)
  assert.equal(d[0]!.prob_atendido, 0.9)
  assert.equal(d[0]!.atendido, true)
})

test('banda cinzenta e reprovação pedem revisão; aprovação folgada não', () => {
  const itens = [item('folga'), item('cinza'), item('reprova')]
  const d = decidirItens(itens, [r('item:folga', 0.95), r('item:cinza', 0.65), r('item:reprova', 0.2)], P)
  const por = new Map(d.map((x) => [x.chave, x]))
  assert.equal(por.get('folga')!.precisa_revisao, false)
  assert.equal(por.get('cinza')!.banda_cinzenta, true)
  assert.equal(por.get('cinza')!.precisa_revisao, true)
  assert.equal(por.get('reprova')!.precisa_revisao, true)
})

test('o limiar calibrado é que corta — 0,75 passa num item com limiar 0,7 (Jev é subconfiante)', () => {
  const itens = [item('a', { limiar: 0.7 })]
  assert.equal(decidirItens(itens, [r('item:a', 0.75)], P)[0]!.atendido, true)
})

test('item em sombra grava e fica fora da nota publicada, mas entra na nota "que seria"', () => {
  const itens = [item('a'), item('b', { status_calibracao: 'sombra_f1' })]
  const d = decidirItens(itens, [r('item:a', 0.9), r('item:b', 0.1)], P)
  assert.equal(calcularNota(d, pesos(itens)).score, 1)
  assert.equal(calcularNota(d, pesos(itens), true).score, 0.5)
})

test('escolha sem lista de atendimento é informativa: grava a escolha, não pontua', () => {
  const itens = [item('objecao_registrada', { tipo_resposta: 'escolha', opcoes: ['preço', 'sem objeção'], atende: null })]
  const d = decidirItens(itens, [{ id: 'item:objecao_registrada', resultado: 'preço', probabilidade: 0.8, provedor: 'jev' }], P)
  assert.equal(d[0]!.resultado, 'preço')
  assert.equal(d[0]!.atendido, null)
  assert.equal(d[0]!.precisa_revisao, false)
  assert.equal(calcularNota(d, pesos(itens)).score, null)
})

test('revisão: Claude decide a banda cinzenta e a divergência fica gravada', () => {
  const itens = [item('cinza')]
  const d = decidirItens(itens, [r('item:cinza', 0.65)], P)
  const [x] = aplicarRevisao(d, [{ chave: 'cinza', atendido: false, citacao: '"vamos ver"', orientacao: 'Marque a data.' }])
  assert.equal(x!.atendido, false)
  assert.equal(x!.provedor, 'claude')
  assert.equal(x!.divergente, true)
  assert.equal(x!.atendido_original, true)
  assert.equal(x!.citacao, '"vamos ver"')
})

test('revisão: Claude discordando de uma reprovação do Jev → não se cobra o vendedor', () => {
  const itens = [item('reprova')]
  const d = decidirItens(itens, [r('item:reprova', 0.1)], P)
  const [x] = aplicarRevisao(d, [{ chave: 'reprova', atendido: true, citacao: 'x', orientacao: 'y' }])
  assert.equal(x!.atendido, true)
  assert.equal(x!.divergente, true)
  assert.equal(x!.citacao, null)
})

test('revisão: reprovado sem revisão NÃO reprova sozinho — sai da nota como pendente', () => {
  const itens = [item('a'), item('reprova')]
  const d = aplicarRevisao(decidirItens(itens, [r('item:a', 0.9), r('item:reprova', 0.1)], P), null)
  const x = d.find((i) => i.chave === 'reprova')!
  assert.equal(x.atendido, null)
  assert.equal(x.revisao_pendente, true)
  assert.equal(calcularNota(d, pesos(itens)).score, 1)
})

test('a explicação sai dos itens', () => {
  const itens = [item('a'), item('b'), item('c')]
  const d = decidirItens(itens, [r('item:a', 0.9), r('item:b', 0.1), r('item:c', 0.1)], P)
  const n = calcularNota(d, pesos(itens))
  const texto = explicarNota(n, new Map([['b', 'próximo passo com data'], ['c', 'objeção de prazo respondida']]))
  assert.equal(texto, '0,33 porque faltou: próximo passo com data e objeção de prazo respondida.')
})
