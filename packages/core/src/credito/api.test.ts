import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BACKOFF_WEBHOOK_MIN,
  MAX_TENTATIVAS_WEBHOOK,
  criarAnaliseExternaSchema,
  documentosFaltantes,
  estagioInicial,
  proximaTentativaWebhook,
} from './api.ts'
import { assinarWebhook, assinaturaConfere } from '../server/credito-api.ts'

test('o CNPJ entra com máscara e sai em 14 dígitos', () => {
  const r = criarAnaliseExternaSchema.parse({
    external_id: 'prod-2026-00123',
    cnpj: '11.222.333/0001-81',
  })
  assert.equal(r.cnpj, '11222333000181')
  // Defaults do contrato: quem não manda recebe o combinado, não `undefined`.
  assert.equal(r.papel, 'sacado')
  assert.equal(r.origem, 'cadastro_plataforma')
  assert.deepEqual(r.documentos, [])
})

test('CNPJ com dígito verificador errado é recusado — não é erro de digitação, é ficha corrompida', () => {
  const r = criarAnaliseExternaSchema.safeParse({ external_id: 'x', cnpj: '11222333000182' })
  assert.equal(r.success, false)
  // E o clássico que passa em qualquer checagem de tamanho.
  assert.equal(criarAnaliseExternaSchema.safeParse({ external_id: 'x', cnpj: '00000000000000' }).success, false)
})

test('sem external_id não há idempotência possível', () => {
  assert.equal(criarAnaliseExternaSchema.safeParse({ cnpj: '11222333000181' }).success, false)
})

test('o checklist diz o que falta, e é ele que decide o estágio de nascimento', () => {
  const essenciais = ['balanco_patrimonial', 'dre', 'faturamento_declarado']
  assert.deepEqual(documentosFaltantes(['balanco_patrimonial'], essenciais), [
    'dre',
    'faturamento_declarado',
  ])
  assert.equal(estagioInicial(['dre']), 'docs_pendentes')
  assert.deepEqual(documentosFaltantes(essenciais, essenciais), [])
  assert.equal(estagioInicial([]), 'docs_recebidos')
})

test('o backoff cresce e ACABA — a sexta tentativa é a última', () => {
  const agora = new Date('2026-09-02T12:00:00Z')
  const minutos = (n: number): number => {
    const d = proximaTentativaWebhook(n, agora)
    assert.ok(d, `tentativa ${n} devia ter próxima`)
    return Math.round((d.getTime() - agora.getTime()) / 60_000)
  }
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(minutos), [...BACKOFF_WEBHOOK_MIN])
  // Esgotado: quem chamar precisa marcar 'falhou' em vez de reagendar para sempre.
  assert.equal(proximaTentativaWebhook(MAX_TENTATIVAS_WEBHOOK, agora), null)
})

test('a assinatura é sobre os BYTES enviados, e confere em tempo constante', () => {
  const corpo = JSON.stringify({ evento: 'credito.estagio_alterado', evento_id: 'abc' })
  const assinatura = assinarWebhook('segredo-do-webhook', corpo)

  assert.match(assinatura, /^[0-9a-f]{64}$/)
  assert.equal(assinaturaConfere('segredo-do-webhook', corpo, assinatura), true)
  // Segredo errado, corpo adulterado e assinatura truncada: todos falham.
  assert.equal(assinaturaConfere('outro-segredo', corpo, assinatura), false)
  assert.equal(assinaturaConfere('segredo-do-webhook', `${corpo} `, assinatura), false)
  assert.equal(assinaturaConfere('segredo-do-webhook', corpo, assinatura.slice(0, 60)), false)
  assert.equal(assinaturaConfere('segredo-do-webhook', corpo, ''), false)
})

test('o mesmo corpo assina igual em execuções diferentes', () => {
  // É o que torna a validação do outro lado possível: eles reassinam e comparam.
  const corpo = '{"a":1,"b":[2,3]}'
  assert.equal(assinarWebhook('s', corpo), assinarWebhook('s', corpo))
})
