import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  calcularAchado,
  calcularContraste,
  forcaDoLift,
  liftRelevante,
  PARAMETROS_CONTRASTE_PADRAO,
  type LinhaCategorizada,
} from './contraste.ts'

/**
 * O risco deste módulo não é errar a divisão: é FALAR quando deveria calar. Cada
 * teste abaixo é uma forma de o painel apresentar ruído com cara de achado.
 */

/** n linhas com a variável `v` valendo `valor`. */
function linhas(n: number, valor: string | null, variavel = 'uf'): LinhaCategorizada[] {
  return Array.from({ length: n }, () => ({ [variavel]: valor }))
}

test('prevalência e lift: a conta básica, sobre quem TEM dado', () => {
  const a = [...linhas(30, 'SP'), ...linhas(20, 'RS')]
  const b = [...linhas(20, 'SP'), ...linhas(80, 'RS')]
  const r = calcularAchado('uf', a, b)

  const sp = r.categorias.find((c) => c.chave === 'SP')
  assert.ok(sp)
  assert.equal(sp.prevalencia_a, 0.6)
  assert.equal(sp.prevalencia_b, 0.2)
  assert.ok(Math.abs((sp.lift as number) - 3) < 1e-9)
  assert.equal(r.destaque?.chave, 'SP')
  assert.equal(r.confianca, 'solida')
})

test('sem dado sai do numerador E do denominador', () => {
  // 30 SP, 20 RS e 50 sem dado: SP é 60% de quem respondeu, não 30% da coorte.
  // Diluir quem não respondeu inventa uma resposta.
  const a = [...linhas(30, 'SP'), ...linhas(20, 'RS'), ...linhas(50, null)]
  const b = [...linhas(20, 'SP'), ...linhas(80, 'RS')]
  const r = calcularAchado('uf', a, b)

  assert.equal(r.n_a, 50)
  assert.equal(r.cobertura_a, 0.5)
  assert.equal(r.categorias.find((c) => c.chave === 'SP')?.prevalencia_a, 0.6)
})

test('N pequeno na célula torna o achado indicativo, mesmo com lift enorme', () => {
  // 3 de 4 é 75% contra 5% — lift 15. E um único caso a mais move tudo.
  const a = [...linhas(3, 'SP'), ...linhas(1, 'RS')]
  const b = [...linhas(5, 'SP'), ...linhas(95, 'RS')]
  const r = calcularAchado('uf', a, b)

  assert.equal(r.confianca, 'indicativo')
  assert.equal(r.destaque, null, 'uma célula de 3 linhas não pode virar a frase do card')
})

test('cobertura baixa suprime o achado do painel principal', () => {
  const a = [...linhas(20, 'SP'), ...linhas(80, null)]
  const b = [...linhas(20, 'SP'), ...linhas(80, 'RS')]
  const r = calcularAchado('uf', a, b)

  assert.equal(r.cobertura_a, 0.2)
  assert.equal(r.suprimido, true)
})

test('basta UM lado com cobertura ruim para suprimir', () => {
  // 95% contra 12% não é um contraste entre coortes: é a coorte contra um
  // recorte da outra, e a barra não denunciaria isso.
  const a = linhas(100, 'SP')
  const b = [...linhas(12, 'SP'), ...linhas(88, null)]
  const r = calcularAchado('uf', a, b)
  assert.equal(r.suprimido, true)
})

test('denominador zero é lift null, jamais Infinity', () => {
  const a = linhas(30, 'AC')
  const b = linhas(100, 'SP')
  const r = calcularAchado('uf', a, b)

  const ac = r.categorias.find((c) => c.chave === 'AC')
  assert.equal(ac?.lift, null)
  assert.equal(ac?.exclusiva_a, true)
  // E não pode virar destaque: "∞× mais provável" é como uma amostra vira política.
  assert.equal(r.destaque, null)
})

test('a categoria só é sólida com N dos DOIS lados', () => {
  const a = linhas(100, 'SP')
  const b = [...linhas(3, 'SP'), ...linhas(97, 'RS')]
  const r = calcularAchado('uf', a, b)
  assert.equal(r.categorias.find((c) => c.chave === 'SP')?.solida, false)
})

test('chaves fixam a ordem das faixas ordinais', () => {
  // Sem isso, "10–20 anos" viria antes de "3–5" por acidente de amostragem.
  const ordem = ['0–3', '3–5', '5–10', '10+']
  const a = [...linhas(20, '10+', 'idade'), ...linhas(20, '3–5', 'idade')]
  const b = [...linhas(20, '0–3', 'idade'), ...linhas(20, '5–10', 'idade')]
  const r = calcularAchado('idade', a, b, PARAMETROS_CONTRASTE_PADRAO, ordem)
  assert.deepEqual(r.categorias.map((c) => c.chave), ordem)
})

test('a força do lift é simétrica — 4× e 0,25× informam igual', () => {
  assert.equal(forcaDoLift({ lift: 4 } as never), 4)
  assert.equal(forcaDoLift({ lift: 0.25 } as never), 4)
  assert.equal(forcaDoLift({ lift: 1 } as never), 1)
  assert.equal(forcaDoLift(null), 0)
})

test('a ordenação põe o lift forte na frente e o suprimido no fim', () => {
  const linha = (uf: string, nj: string | null, porte: string): LinhaCategorizada => ({
    uf,
    nj,
    porte,
  })
  // uf  → lift 3 dos dois lados, cobertura total.
  // porte → distribuição idêntica nas duas coortes: lift 1, nada a dizer.
  // nj  → cobertura 20% em A: suprimido, por mais alto que fosse o lift.
  const a = [
    ...Array.from({ length: 60 }, () => linha('SP', null, 'ME')),
    ...Array.from({ length: 20 }, () => linha('RS', null, 'ME')),
    ...Array.from({ length: 20 }, () => linha('RS', 'sa', 'ME')),
  ]
  const b = [
    ...Array.from({ length: 20 }, () => linha('SP', 'ltda', 'ME')),
    ...Array.from({ length: 80 }, () => linha('RS', 'ltda', 'ME')),
  ]

  const r = calcularContraste([{ id: 'nj' }, { id: 'porte' }, { id: 'uf' }], a, b)
  assert.equal(r[0]?.variavel, 'uf', 'o lift mais forte abre a lista')
  assert.equal(r[0]?.suprimido, false)
  assert.equal(r.at(-1)?.variavel, 'nj', 'cobertura de 20% vai para o fim')
  assert.equal(r.at(-1)?.suprimido, true)
})

test('liftRelevante exige célula sólida — não só número alto', () => {
  const fraca = { lift: 9, solida: false } as never
  const forte = { lift: 3, solida: true } as never
  assert.equal(liftRelevante(fraca), false)
  assert.equal(liftRelevante(forte), true)
  assert.equal(liftRelevante({ lift: 1.5, solida: true } as never), false)
  // Negativo também conta: 0,2× é 5× menos provável.
  assert.equal(liftRelevante({ lift: 0.2, solida: true } as never), true)
})

test('coorte vazia não explode e não inventa cobertura', () => {
  const r = calcularAchado('uf', [], linhas(50, 'SP'))
  assert.equal(r.n_a, 0)
  assert.equal(r.cobertura_a, 0)
  assert.equal(r.destaque, null)
  assert.equal(r.suprimido, true)
})
