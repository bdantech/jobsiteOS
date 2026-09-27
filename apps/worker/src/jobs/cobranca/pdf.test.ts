import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distribuirLarguras, lerInline, lerMarkdown, markdownParaPdf, paraWinAnsi } from './pdf.ts'

/**
 * O que dá para errar num renderizador de carta: juntar linhas que eram separadas,
 * ler a linha de assinatura como ênfase, perder a coluna de valores de uma tabela, e
 * mandar para a Helvetica um caractere que ela desenha como lixo sem avisar.
 */

test('negrito e itálico viram trechos; o sublinhado da assinatura fica como está', () => {
  assert.deepEqual(lerInline('**Notificante:** ACME, CNPJ 1'), [
    { texto: 'Notificante:', negrito: true, italico: false },
    { texto: ' ACME, CNPJ 1', negrito: false, italico: false },
  ])
  assert.deepEqual(lerInline('um *aviso* aqui'), [
    { texto: 'um ', negrito: false, italico: false },
    { texto: 'aviso', negrito: false, italico: true },
    { texto: ' aqui', negrito: false, italico: false },
  ])
  assert.deepEqual(lerInline('_____________________________ CREDORA'), [
    { texto: '_____________________________ CREDORA', negrito: false, italico: false },
  ])
})

test('quebra simples é linha nova; linha em branco é parágrafo novo', () => {
  const b = lerMarkdown('**Valor de face:** R$ 1,00\n**Valor atualizado:** R$ 2,00\n\nAtenciosamente,')
  assert.equal(b.length, 2)
  assert.equal(b[0]!.tipo, 'paragrafo')
  assert.equal((b[0] as { linhas: unknown[] }).linhas.length, 2)
})

test('títulos, listas e régua', () => {
  const b = lerMarkdown('# NOTIFICAÇÃO\n\n## 1. Origem\n\n- um\n- dois\n\n1. a\n2. b\n\n---\n')
  assert.deepEqual(
    b.map((x) => x.tipo),
    ['titulo', 'titulo', 'lista', 'lista', 'regua'],
  )
  assert.equal((b[0] as { nivel: number }).nivel, 1)
  assert.equal((b[3] as { ordenada: boolean }).ordenada, true)
  // o número escrito é o que vale: "2." sozinho não vira "1." (as testemunhas da minuta)
  assert.deepEqual((lerMarkdown('2. _____\nNome: B')[0] as { numeros: number[] }).numeros, [2])
  // "**Negrito:**" começa com asterisco e NÃO é item de lista
  assert.equal(lerMarkdown('**Notificada:** X')[0]!.tipo, 'paragrafo')
})

test('tabela com alinhamento; sem separador não é tabela', () => {
  const md = '| Título | Dias | Valor |\n|---|:---:|---:|\n| 1234 | 78 | R$ 48.500,00 |\n| 99 | 3 |'
  const [t] = lerMarkdown(md)
  assert.equal(t!.tipo, 'tabela')
  const tab = t as Extract<typeof t, { tipo: 'tabela' }>
  assert.deepEqual(tab.alinhamentos, ['left', 'center', 'right'])
  assert.deepEqual(tab.linhas[1], ['99', '3', ''])
  assert.equal(lerMarkdown('| só uma linha |')[0]!.tipo, 'paragrafo')
})

test('WinAnsi: acentos passam, seta e menos viram ASCII, emoji vira ?', () => {
  assert.equal(paraWinAnsi('Notificação — § 3º · R$ 1.234,56 × 2'), 'Notificação — § 3º · R$ 1.234,56 × 2')
  assert.equal(paraWinAnsi('A → B ≠ C − 1'), 'A -> B <> C - 1')
  assert.equal(paraWinAnsi('ok 😀'), 'ok ?')
  assert.equal(paraWinAnsi('a​b'), 'ab')
})

test('larguras: sobra vai proporcional; falta tira de quem é longo, nunca abaixo da palavra', () => {
  const folga = distribuirLarguras([100, 100], [10, 10], 400)
  assert.deepEqual(folga, [200, 200])
  const aperto = distribuirLarguras([300, 60], [50, 60], 200)
  assert.ok(Math.abs(aperto[0]! + aperto[1]! - 200) < 1e-9)
  assert.equal(aperto[1], 60)
})

test('o PDF sai, e uma tabela longa quebra de página sem erro', async () => {
  const linhas = Array.from({ length: 120 }, (_, k) => `| ${k} | CONSTRUTORA EXEMPLO SPE ${k} LTDA | R$ 1.000,00 |`)
  const md = `# Teste\n\nParágrafo com **negrito**.\n\n| Nº | SPE | Valor |\n|---|---|---:|\n${linhas.join('\n')}\n`
  const pdf = await markdownParaPdf(md, { titulo: 'Teste', rodape: 'COB-2026-0001' })
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
  assert.ok(pdf.byteLength > 2000)
})
