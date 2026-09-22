import assert from 'node:assert/strict'
import { test } from 'node:test'
import { juntarPaginas, valorDeOrdenacao } from './juntar-paginas.ts'

const nf = (id: string, receita: string) => ({ tipo: 'nf', id, receita_esperada: receita })
const pa = (id: string, receita: string) => ({ tipo: 'pre_autorizacao', id, receita_esperada: receita })

test('numeric do Postgres chega como STRING, e é número — não data', () => {
  // O bug de 22/09/2026: `Date.parse("16500.00")` é NaN, e a ordenação caía no
  // desempate sem avisar ninguém.
  assert.equal(valorDeOrdenacao('16500.00'), 16500)
  assert.equal(valorDeOrdenacao('900'), 900)
  assert.equal(valorDeOrdenacao(1234.5), 1234.5)
})

test('data ISO cai no Date.parse, que é a segunda tentativa', () => {
  assert.equal(valorDeOrdenacao('2026-09-22T12:00:00Z'), Date.parse('2026-09-22T12:00:00Z'))
})

test('nulo, indefinido e string vazia são ausência, não zero', () => {
  assert.equal(valorDeOrdenacao(null), null)
  assert.equal(valorDeOrdenacao(undefined), null)
  assert.equal(valorDeOrdenacao(''), null)
})

test('a página final é a que a união produziria, com as fontes intercaladas', () => {
  const daNf = [nf('a', '900'), nf('b', '500'), nf('c', '100')]
  const daPre = [pa('1', '700'), pa('2', '300')]

  const pagina = juntarPaginas([daNf, daPre], {
    coluna: 'receita_esperada',
    ascendente: false,
    pagina: 0,
    limite: 5,
  })

  assert.deepEqual(
    pagina.map((o) => `${o.tipo}:${o.id}`),
    ['nf:a', 'pre_autorizacao:1', 'nf:b', 'pre_autorizacao:2', 'nf:c'],
  )
})

test('crescente inverte a ordem, mas o nulo continua no fim', () => {
  const linhas = [nf('a', '900'), nf('b', '100'), { tipo: 'nf', id: 'c', receita_esperada: null }]

  const desc = juntarPaginas([linhas], {
    coluna: 'receita_esperada', ascendente: false, pagina: 0, limite: 3,
  })
  assert.deepEqual(desc.map((o) => o.id), ['a', 'b', 'c'])

  const asc = juntarPaginas([linhas], {
    coluna: 'receita_esperada', ascendente: true, pagina: 0, limite: 3,
  })
  // `c` é nulo e fica no fim NAS DUAS direções — senão inverter a ordem encheria
  // a primeira página de linhas sem valor.
  assert.deepEqual(asc.map((o) => o.id), ['b', 'a', 'c'])
})

test('a segunda página continua de onde a primeira parou', () => {
  const daNf = [nf('a', '900'), nf('b', '500'), nf('c', '100')]
  const daPre = [pa('1', '700'), pa('2', '300')]
  const opcoes = { coluna: 'receita_esperada', ascendente: false, limite: 2 }

  const p0 = juntarPaginas([daNf, daPre], { ...opcoes, pagina: 0 })
  const p1 = juntarPaginas([daNf, daPre], { ...opcoes, pagina: 1 })

  assert.deepEqual(p0.map((o) => o.id), ['a', '1'])
  assert.deepEqual(p1.map((o) => o.id), ['b', '2'])
})

test('valores iguais desempatam pelo PAR (tipo, id), de forma estável', () => {
  // `id` sozinho não basta: uma pré-autorização 4242 e uma parcela 4242 podem
  // coexistir, e paginar por OFFSET com desempate instável repete um card e some
  // com outro.
  const linhas = [
    { tipo: 'titulo', id: '4242', receita_esperada: '100' },
    { tipo: 'pre_autorizacao', id: '4242', receita_esperada: '100' },
  ]
  const r = juntarPaginas([linhas], {
    coluna: 'receita_esperada', ascendente: false, pagina: 0, limite: 2,
  })
  assert.deepEqual(r.map((o) => `${o.tipo}:${o.id}`), ['pre_autorizacao:4242', 'titulo:4242'])
})
