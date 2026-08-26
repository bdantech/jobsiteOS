import assert from 'node:assert/strict'
import { test } from 'node:test'
import { linhasDoContexto, montarContexto } from './contexto.ts'

test('o navegador e o celular produzem o MESMO formato de objeto', () => {
  const web = montarContexto({
    rota: '/comercial/fornecedores',
    url: 'https://app.example/comercial/fornecedores?aba=kanban',
    plataforma: 'web',
    userAgent: 'Mozilla/5.0 (Macintosh)',
    viewport: { largura: 1440, altura: 900 },
    appVersao: '0.1.0',
  })
  const mobile = montarContexto({
    rota: '/comercial/fornecedores',
    plataforma: 'ios',
    viewport: { largura: 390, altura: 844 },
    appVersao: '0.1.0',
  })

  assert.deepEqual(Object.keys(web).sort(), Object.keys(mobile).sort())
  assert.equal(web.viewport, '1440×900')
  assert.equal(mobile.viewport, '390×844')
  // O celular não tem URL. Ausente é null, e não uma URL inventada a partir da rota.
  assert.equal(mobile.url, null)
  assert.equal(mobile.user_agent, null)
})

test('uma plataforma que não conhecemos vira "desconhecida", e não some', () => {
  assert.equal(montarContexto({ plataforma: 'windows' }).plataforma, 'desconhecida')
  assert.equal(montarContexto({}).plataforma, 'desconhecida')
  assert.equal(montarContexto({ plataforma: '  IOS  ' }).plataforma, 'ios')
})

test('a viewport fracionária do zoom é arredondada — 1439.2×899.5 não compara com nada', () => {
  assert.equal(montarContexto({ viewport: { largura: 1439.2, altura: 899.5 } }).viewport, '1439×900')
})

test('viewport impossível não é gravada como se fosse medida', () => {
  for (const v of [
    { largura: 0, altura: 800 },
    { largura: -1, altura: 800 },
    { largura: Number.NaN, altura: 800 },
    { largura: 800 },
    null,
  ]) {
    assert.equal(montarContexto({ viewport: v as never }).viewport, null, JSON.stringify(v))
  }
})

test('o user agent patológico é cortado no limite que a coluna aceita', () => {
  const r = montarContexto({ userAgent: 'x'.repeat(4000) })
  assert.equal(r.user_agent?.length, 500)
})

test('campo em branco vira null, nunca string vazia', () => {
  const r = montarContexto({ rota: '   ', url: '', appVersao: '  ' })
  assert.equal(r.rota, null)
  assert.equal(r.url, null)
  assert.equal(r.app_versao, null)
})

test('a lista de detalhes técnicos omite o que não foi capturado', () => {
  const linhas = linhasDoContexto(
    montarContexto({ rota: '/mercado', plataforma: 'android', appVersao: '0.1.0' }),
  )
  assert.deepEqual(linhas, [
    { rotulo: 'Rota', valor: '/mercado' },
    { rotulo: 'Plataforma', valor: 'android' },
    { rotulo: 'Versão', valor: '0.1.0' },
  ])
})

test('contexto ausente não quebra a tela do admin', () => {
  assert.deepEqual(linhasDoContexto(null), [])
  assert.deepEqual(linhasDoContexto(undefined), [])
  assert.deepEqual(linhasDoContexto({}), [])
})
