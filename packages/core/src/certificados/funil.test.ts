import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ESTAGIOS_CERTIFICADO,
  ESTAGIO_CERTIFICADO_LABELS,
  moverCertificadoCardSchema,
  pctCobertura,
  podeGanhar,
} from './funil.ts'

const CARD = '11111111-1111-4111-8111-111111111111'
const MOTIVO = '22222222-2222-4222-8222-222222222222'

test('toda coluna tem rótulo — a UI itera o array e indexa o mapa', () => {
  for (const e of ESTAGIOS_CERTIFICADO) {
    assert.ok(ESTAGIO_CERTIFICADO_LABELS[e], `sem rótulo para ${e}`)
  }
})

/**
 * A regra que o usuário fixou e que o banco também aplica: é o certificado da MATRIZ
 * que destrava a ingestão de NF-e. Um card fechado sem ele seria uma cegueira marcada
 * como resolvida.
 */
test('sem o certificado da matriz não se ganha', () => {
  assert.equal(podeGanhar(false), false)
  assert.equal(podeGanhar(true), true)
})

test('perder exige motivo, e o schema é quem recusa antes do banco', () => {
  const sem = moverCertificadoCardSchema.safeParse({ card_id: CARD, estagio: 'perdido' })
  assert.equal(sem.success, false)
  const com = moverCertificadoCardSchema.safeParse({
    card_id: CARD,
    estagio: 'perdido',
    perdido_motivo: MOTIVO,
  })
  assert.equal(com.success, true)
})

test('ganhar não exige motivo — motivo é do fracasso, não do sucesso', () => {
  const r = moverCertificadoCardSchema.safeParse({ card_id: CARD, estagio: 'ganho' })
  assert.equal(r.success, true)
})

test('estágio fora da lista não passa', () => {
  const r = moverCertificadoCardSchema.safeParse({ card_id: CARD, estagio: 'inventado' })
  assert.equal(r.success, false)
})

/**
 * O maior card da base tem 371 CNPJs e 0 cobertos. O percentual precisa dizer 0, e
 * não quebrar nem arredondar para cima — a barra desenha um fio, e é isso mesmo.
 */
test('percentual arredonda, e grupo vazio é null e não 0%', () => {
  assert.equal(pctCobertura(0, 371), 0)
  assert.equal(pctCobertura(2, 371), 1)
  assert.equal(pctCobertura(371, 371), 100)
  assert.equal(pctCobertura(1, 3), 33)
  assert.equal(pctCobertura(0, 0), null, 'sem CNPJ nenhum não é "0% coberto"')
})
