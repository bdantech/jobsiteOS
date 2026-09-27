import assert from 'node:assert/strict'
import { test } from 'node:test'
import { avaliarDisjuntor, type ConfigDisjuntor, type SinalAcao } from './disjuntor.ts'

const CFG: ConfigDisjuntor = {
  janela_acoes: 20,
  limiar_supressao: 0.1,
  limiar_sem_interesse: 0.6,
  limiar_escalacao: 0.3,
  limiar_falha_tecnica: 0.25,
}

const vezes = (s: SinalAcao, n: number): SinalAcao[] => Array.from({ length: n }, () => s)

test('janela incompleta não abre — nem com 100% de supressão', () => {
  const r = avaliarDisjuntor({ sinais: vezes('supressao', 5), config: CFG, estadoAtual: 'ok' })
  assert.equal(r.estado, 'ok')
  assert.equal(r.taxas, null)
  assert.equal(r.acoesNaJanela, 5)
})

test('ações neutras (consultas) não contam para a janela', () => {
  const sinais = [...vezes('neutro', 40), ...vezes('supressao', 3)]
  const r = avaliarDisjuntor({ sinais, config: CFG, estadoAtual: 'ok' })
  assert.equal(r.acoesNaJanela, 3)
  assert.equal(r.estado, 'ok')
})

test('limiar exato NÃO abre; um acima abre', () => {
  // 2 de 20 = 10% = exatamente o limiar de supressão.
  const exato = avaliarDisjuntor({ sinais: [...vezes('supressao', 2), ...vezes('ok', 18)], config: CFG, estadoAtual: 'ok' })
  assert.notEqual(exato.estado, 'aberto')
  // 3 de 20 = 15%: ultrapassou.
  const acima = avaliarDisjuntor({ sinais: [...vezes('supressao', 3), ...vezes('ok', 17)], config: CFG, estadoAtual: 'ok' })
  assert.equal(acima.estado, 'aberto')
  assert.equal(acima.metrica, 'supressao')
  assert.match(acima.motivo!, /15% das últimas 20/)
})

test('a janela é das ÚLTIMAS N ações: supressões antigas saem dela', () => {
  // Mais recente primeiro: 20 ok recentes, 5 supressões antigas fora da janela.
  const r = avaliarDisjuntor({ sinais: [...vezes('ok', 20), ...vezes('supressao', 5)], config: CFG, estadoAtual: 'ok' })
  assert.equal(r.estado, 'ok')
})

test('perto do limiar acende alerta sem parar nada', () => {
  // 5 de 20 escalações = 25%, acima de 75% do limiar (22,5%) e abaixo de 30%.
  const r = avaliarDisjuntor({ sinais: [...vezes('escalacao', 5), ...vezes('ok', 15)], config: CFG, estadoAtual: 'ok' })
  assert.equal(r.estado, 'alerta')
})

test('aberto fica aberto até a reabertura manual, que zera a janela', () => {
  // Mesmo com a janela limpa depois, quem fecha é uma pessoa.
  const ainda = avaliarDisjuntor({ sinais: vezes('ok', 30), config: CFG, estadoAtual: 'aberto' })
  assert.equal(ainda.estado, 'aberto')
  // Reaberto (janela_desde = agora): não há ações na janela, o disjuntor volta ao normal e
  // as supressões que o abriram não contam mais.
  const reaberto = avaliarDisjuntor({ sinais: [], config: CFG, estadoAtual: 'ok' })
  assert.equal(reaberto.estado, 'ok')
})

test('prioridade do motivo é a do dano: supressão antes de sem interesse', () => {
  const sinais = [...vezes('supressao', 4), ...vezes('sem_interesse', 14), ...vezes('ok', 2)]
  const r = avaliarDisjuntor({ sinais, config: CFG, estadoAtual: 'ok' })
  assert.equal(r.metrica, 'supressao')
})
