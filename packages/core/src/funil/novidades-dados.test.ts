import assert from 'node:assert/strict'
import { test } from 'node:test'
import { anosParaImportar, importarFeriadosNacionais, normalizarFeriados } from './novidades-dados.ts'

const RESPOSTA = [
  { date: '2026-01-01', name: 'Confraternização mundial', type: 'national' },
  { date: '2026-04-03', name: 'Sexta-feira Santa', type: 'national' },
  { date: '2026-04-03', name: 'Sexta-feira Santa (repetida)', type: 'national' },
  { date: '2027-01-01', name: 'Do ano errado', type: 'national' },
  { date: 'amanhã', name: 'Data torta' },
  { date: '2026-12-25' },
]

test('a resposta da BrasilAPI vira só o que se grava', () => {
  assert.deepEqual(normalizarFeriados(RESPOSTA, 2026), [
    { data: '2026-01-01', nome: 'Confraternização mundial' },
    { data: '2026-04-03', nome: 'Sexta-feira Santa' },
  ])
  assert.deepEqual(normalizarFeriados({ message: 'erro' }, 2026), [])
  assert.deepEqual(normalizarFeriados(null, 2026), [])
})

/** Um client que só anota o que recebeu. */
function clienteFalso() {
  const lotes: { linhas: Record<string, unknown>[]; opcoes: unknown }[] = []
  const supabase = {
    from: (tabela: string) => ({
      upsert: async (linhas: Record<string, unknown>[], opcoes: unknown) => {
        assert.equal(tabela, 'dias_nao_uteis')
        lotes.push({ linhas, opcoes })
        return { error: null }
      },
    }),
  }
  return { supabase: supabase as never, lotes }
}

test('um ano que falha não impede o outro, e nada é sobrescrito', async () => {
  const { supabase, lotes } = clienteFalso()
  const r = await importarFeriadosNacionais(supabase, [2026, 2027], async (url) => {
    if (url.endsWith('/2027')) throw new Error('BrasilAPI respondeu 503')
    return RESPOSTA
  })

  assert.equal(r.gravados, 2)
  assert.deepEqual(r.anos, [
    { ano: 2026, feriados: 2 },
    { ano: 2027, feriados: 0, erro: 'BrasilAPI respondeu 503' },
  ])
  assert.equal(lotes.length, 1)
  // `ignoreDuplicates`: o dia que o gestor cadastrou à mão fica como ele deixou.
  assert.deepEqual(lotes[0]!.opcoes, { onConflict: 'data', ignoreDuplicates: true })
  // Todas as linhas com as mesmas chaves — lote de formato misturado grava NULL.
  for (const l of lotes[0]!.linhas) {
    assert.deepEqual(Object.keys(l).sort(), ['data', 'escopo', 'nome', 'origem'])
    assert.equal(l.origem, 'brasilapi')
  }
})

test('resposta vazia é erro do ano, não um ano "importado" sem feriado nenhum', async () => {
  const { supabase, lotes } = clienteFalso()
  const r = await importarFeriadosNacionais(supabase, [2026], async () => [])
  assert.equal(r.anos[0]?.erro, 'resposta sem feriados')
  assert.equal(lotes.length, 0)
})

test('o job popula o ano corrente e o seguinte, no fuso de Brasília', () => {
  // 01:00Z de 1º de janeiro ainda é 31 de dezembro em São Paulo.
  assert.deepEqual(anosParaImportar(new Date('2027-01-01T01:00:00Z')), [2026, 2027])
  assert.deepEqual(anosParaImportar(new Date('2027-01-01T04:00:00Z')), [2027, 2028])
})
