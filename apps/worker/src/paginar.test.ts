import assert from 'node:assert/strict'
import { test } from 'node:test'
import { todasAsPaginas } from './paginar.ts'

/**
 * O que se testa aqui é o corte silencioso: a resposta que vem menor sem erro. Um teste
 * que só verificasse "trouxe alguma coisa" passaria com o bug original intacto.
 */

/** Um "banco" de n linhas que corta cada resposta no tamanho da página, como o PostgREST. */
function fonte(n: number, tamanhoMax: number) {
  const linhas = Array.from({ length: n }, (_, i) => ({ id: i }))
  let chamadas = 0
  return {
    get chamadas() {
      return chamadas
    },
    consultar: async (de: number, ate: number) => {
      chamadas++
      const limite = Math.min(ate - de + 1, tamanhoMax)
      return { data: linhas.slice(de, de + limite), error: null }
    },
  }
}

test('traz tudo quando o total passa do teto de uma página', () => {
  const f = fonte(1614, 1000)
  return todasAsPaginas(f.consultar, 1000).then((r) => {
    assert.equal(r.length, 1614)
    assert.equal(r[0]?.id, 0)
    assert.equal(r[1613]?.id, 1613)
    assert.equal(f.chamadas, 2)
  })
})

test('página cheia exata pede a próxima em vez de parar no múltiplo', () => {
  // O off-by-one clássico: 2.000 linhas em páginas de 1.000 devolvem duas páginas
  // cheias, e parar na segunda seria indistinguível de ter acabado.
  const f = fonte(2000, 1000)
  return todasAsPaginas(f.consultar, 1000).then((r) => {
    assert.equal(r.length, 2000)
    assert.equal(f.chamadas, 3) // a terceira volta vazia e encerra
  })
})

test('menos que uma página é uma chamada só', async () => {
  const f = fonte(37, 1000)
  assert.equal((await todasAsPaginas(f.consultar, 1000)).length, 37)
  assert.equal(f.chamadas, 1)
})

test('vazio é vazio, não trava', async () => {
  const f = fonte(0, 1000)
  assert.deepEqual(await todasAsPaginas(f.consultar, 1000), [])
  assert.equal(f.chamadas, 1)
})

test('erro do PostgREST estoura em vez de virar lista curta', async () => {
  await assert.rejects(
    () => todasAsPaginas(async () => ({ data: null, error: { message: 'timeout' } })),
    /timeout/,
  )
})
