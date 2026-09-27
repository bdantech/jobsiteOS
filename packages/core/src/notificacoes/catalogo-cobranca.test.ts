import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EVENTO_LABELS, EVENTO_TIPOS } from '../constants.ts'
import { MODULOS_NOTIFICACAO } from './regras.ts'

/*
 * Os tipos que a 0269g semeia em `notificacao_tipos` com módulo `cobranca`. Um tipo sem
 * rótulo aparece cru na timeline e no sino ("cobranca.reiteracao_devida"); esta lista é
 * a da migração, e o teste quebra se alguém acrescentar lá e esquecer aqui.
 */
const TIPOS_0269G = [
  'cobranca.criada', 'cobranca.notificacao_gerada', 'cobranca.notificacao_enviada',
  'cobranca.notificacao_entregue', 'cobranca.notificacao_devolvida', 'cobranca.reiteracao',
  'cobranca.reiteracao_devida', 'cobranca.titulo_quitado', 'cobranca.acordo_simulado',
  'cobranca.acordo_assinado', 'cobranca.convertida_em_processo', 'cobranca.encerrada',
  'cobranca.sacado_bloqueado', 'cobranca.sacado_regularizado', 'cobranca.aviso_apolice_aceito',
  'cobranca.contato_registrado', 'protesto.remessa_enviada', 'protesto.instrucao_cancelamento',
  'protesto.apontado', 'protesto.protestado', 'protesto.retirado', 'protesto.retirada_pendente',
  'sinistro.criado', 'sinistro.notificado', 'sinistro.enviado', 'sinistro.doc_solicitado',
  'sinistro.doc_prazo', 'sinistro.aceito', 'sinistro.recusado', 'sinistro.indenizado',
  'apolice.prazo_alerta', 'apolice.prazo_critico', 'apolice.prazo_perdido',
  'apolice.insolvencia_registrada', 'apolice.insolvencia_detectada',
]

test('todo tipo de aviso da Cobrança tem constante e rótulo pt-BR', () => {
  const tipos = new Set<string>(Object.values(EVENTO_TIPOS))
  for (const t of TIPOS_0269G) {
    assert.ok(tipos.has(t), `EVENTO_TIPOS sem ${t}`)
    assert.ok(EVENTO_LABELS[t], `EVENTO_LABELS sem ${t}`)
  }
})

test('o módulo cobranca tem nome no catálogo de avisos', () => {
  assert.equal(MODULOS_NOTIFICACAO.cobranca, 'Cobrança')
})
