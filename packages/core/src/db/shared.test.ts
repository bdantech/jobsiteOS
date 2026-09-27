import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PostgrestError } from '@supabase/supabase-js'
import { traduzirErro } from './shared.ts'

function erro(code: string, message: string): PostgrestError {
  return { code, message, details: '', hint: '', name: 'PostgrestError' } as PostgrestError
}

test('22023 com explicação em pt-BR passa adiante — é a regra de negócio falando', () => {
  const e = traduzirErro(
    erro('22023', 'Este sacado está em cobrança extrajudicial: novas análises ficam suspensas até a regularização.'),
  )
  assert.equal(e.code, 'invalid')
  assert.match(e.message, /cobrança extrajudicial/)
})

test('22023 do próprio Postgres (inglês, sem acento) continua genérico', () => {
  const e = traduzirErro(erro('22023', 'cannot extract elements from a scalar'))
  assert.equal(e.code, 'unknown')
  assert.equal(e.message, 'Não foi possível concluir a operação.')
})

test('os demais códigos não mudaram', () => {
  assert.equal(traduzirErro(erro('42501', 'permission denied')).code, 'forbidden')
  assert.equal(traduzirErro(erro('23514', 'violates check')).code, 'invalid')
})

test('23505, 42501 e P0002 levantados pelas nossas RPCs mantêm a explicação', () => {
  const dup = traduzirErro(erro('23505', 'Há título já em cobrança ativa (COB-2026-0001).'))
  assert.equal(dup.code, 'duplicate')
  assert.match(dup.message, /COB-2026-0001/)
  assert.match(traduzirErro(erro('42501', 'Somente a gestão de cobrança pode fazer isso.')).message, /gestão de cobrança/)
  assert.equal(traduzirErro(erro('P0002', 'Cobrança não encontrada.')).message, 'Cobrança não encontrada.')
})

test('as mesmas violações vindas do Postgres continuam traduzidas', () => {
  assert.equal(
    traduzirErro(erro('23505', 'duplicate key value violates unique constraint "empresas_cnpj_key"')).message,
    'Já existe uma empresa cadastrada com este CNPJ.',
  )
  assert.equal(traduzirErro(erro('23505', 'duplicate key value violates unique constraint "x"')).message, 'Já existe um registro com estes dados.')
  assert.equal(traduzirErro(erro('42501', 'new row violates row-level security policy')).message, 'Você não tem permissão para esta ação.')
})
