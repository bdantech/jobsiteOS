import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { deveRemover, reterApenas } from './retencao.ts'

/**
 * A rotina apaga 8 GB de uma vez. O que se testa aqui é exatamente o que dá para
 * errar: apagar a pasta do mês que está sendo baixado, apagar o que não é dump,
 * ou não apagar nada e deixar o volume encher.
 */

test('deveRemover: mantém o mês corrente e apaga os outros', () => {
  assert.equal(deveRemover('2026-08', '2026-08'), false)
  assert.equal(deveRemover('2026-07', '2026-08'), true)
  assert.equal(deveRemover('2025-12', '2026-08'), true)
  // Um mês FUTURO no disco também sai: só sobrevive o mês da execução.
  assert.equal(deveRemover('2026-09', '2026-08'), true)
})

test('deveRemover: não toca no que não é dump de mês', () => {
  assert.equal(deveRemover('amostra', '2026-08'), false)
  assert.equal(deveRemover('lost+found', '2026-08'), false)
  assert.equal(deveRemover('2026-8', '2026-08'), false)
  assert.equal(deveRemover('backup-2026-07', '2026-08'), false)
})

test('deveRemover: o caminho legado do CNO sai sempre', () => {
  // Sem mês no nome, ele era reaproveitado para sempre — dado velho reportando sucesso.
  assert.equal(deveRemover('cno', '2026-08'), true)
})

test('reterApenas: remove as pastas certas e conta os bytes', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'retencao-'))

  await mkdir(join(raiz, '2026-07'))
  await writeFile(join(raiz, '2026-07', 'Empresas0.zip'), 'x'.repeat(1000))
  await mkdir(join(raiz, '2026-07', 'sub'))
  await writeFile(join(raiz, '2026-07', 'sub', 'Socios0.zip'), 'y'.repeat(500))
  await mkdir(join(raiz, 'cno'))
  await writeFile(join(raiz, 'cno', 'cno.zip'), 'z'.repeat(200))
  await mkdir(join(raiz, '2026-08'))
  // O .parcial do mês corrente é a retomada por Range, não lixo: tem de sobreviver.
  await writeFile(join(raiz, '2026-08', 'Empresas0.zip.parcial'), 'w'.repeat(10))
  await mkdir(join(raiz, 'amostra'))
  await writeFile(join(raiz, 'solto.txt'), 'nao e nosso')

  const r = await reterApenas(raiz, '2026-08')

  assert.deepEqual(r.removidos.sort(), ['2026-07', 'cno'])
  assert.equal(r.bytes_liberados, 1700)

  const restou = (await readdir(raiz)).sort()
  assert.deepEqual(restou, ['2026-08', 'amostra', 'solto.txt'])
  assert.deepEqual(await readdir(join(raiz, '2026-08')), ['Empresas0.zip.parcial'])
})

test('reterApenas: é idempotente e aceita diretório inexistente', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'retencao-'))
  await mkdir(join(raiz, '2026-07'))

  assert.deepEqual((await reterApenas(raiz, '2026-08')).removidos, ['2026-07'])
  assert.deepEqual((await reterApenas(raiz, '2026-08')).removidos, [])
  assert.deepEqual((await reterApenas(join(raiz, 'nao-existe'), '2026-08')).removidos, [])
})

test('reterApenas: mês malformado falha em vez de limpar tudo', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'retencao-'))
  await mkdir(join(raiz, '2026-07'))

  await assert.rejects(() => reterApenas(raiz, 'agosto'), /Mês inválido/)
  assert.deepEqual(await readdir(raiz), ['2026-07'])
})
