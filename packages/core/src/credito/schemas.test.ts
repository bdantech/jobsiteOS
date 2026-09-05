import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  COLUNAS_ESTEIRA,
  DESFECHO_DA_DECISAO,
  ESTAGIOS_ANALISE,
  ESTAGIOS_ANALISE_ABERTOS,
  ESTAGIO_ANALISE_LABELS,
  concluirAnaliseSchema,
  ehEstagioDecidido,
  moverAnaliseSchema,
  podeConcluirPelaDecisao,
  podeEnviarASeguradora,
} from './schemas.ts'

const ID = '11111111-1111-4111-8111-111111111111'

test('o vocabulário da esteira não tem mais "expirada"', () => {
  assert.equal((ESTAGIOS_ANALISE as readonly string[]).includes('expirada'), false)
  assert.equal((COLUNAS_ESTEIRA as readonly string[]).includes('expirada'), false)
  // E o que a substituiu não é outro estágio: é a data. Vencido continua sendo o
  // desfecho que foi, com `expira_em` no passado.
  assert.equal(ehEstagioDecidido('expirada'), false)
  assert.equal(ehEstagioDecidido('aprovada'), true)
  assert.equal(ehEstagioDecidido('aprovada_parcial'), true)
  assert.equal(ehEstagioDecidido('negada'), true)
})

test('todo estágio tem rótulo, e toda coluna é um estágio', () => {
  for (const e of ESTAGIOS_ANALISE) assert.equal(typeof ESTAGIO_ANALISE_LABELS[e], 'string')
  for (const c of COLUNAS_ESTEIRA) {
    assert.equal((ESTAGIOS_ANALISE as readonly string[]).includes(c), true)
  }
  // `cancelada` fica de fora das colunas: é fim administrativo, não etapa.
  assert.equal((COLUNAS_ESTEIRA as readonly string[]).includes('cancelada'), false)
})

test('documentos recebidos é etapa aberta, manual, e fica entre pendentes e o envio', () => {
  assert.equal((ESTAGIOS_ANALISE_ABERTOS as readonly string[]).includes('docs_recebidos'), true)
  assert.equal(moverAnaliseSchema.safeParse({ id: ID, estagio: 'docs_recebidos' }).success, true)

  const ordem = COLUNAS_ESTEIRA as readonly string[]
  assert.ok(ordem.indexOf('docs_pendentes') < ordem.indexOf('docs_recebidos'))
  assert.ok(ordem.indexOf('docs_recebidos') < ordem.indexOf('enviada_seguradora'))
})

test('a tela move o que é nosso e não move o que é desfecho', () => {
  for (const e of ['rascunho', 'solicitada', 'docs_pendentes', 'docs_recebidos', 'cancelada']) {
    assert.equal(moverAnaliseSchema.safeParse({ id: ID, estagio: e }).success, true, e)
  }
  // Desfecho não se define movendo o card: ele sai da decisão, por `app_concluir_analise`.
  for (const e of ['aprovada', 'aprovada_parcial', 'negada', 'enviada_seguradora', 'em_analise']) {
    assert.equal(moverAnaliseSchema.safeParse({ id: ID, estagio: e }).success, false, e)
  }
})

test('só solicitada e documentos recebidos vão à seguradora', () => {
  assert.equal(podeEnviarASeguradora('solicitada'), true)
  assert.equal(podeEnviarASeguradora('docs_recebidos'), true)
  // Faltando documento ainda não é hora: o envio resolve buyer, e isso pode ser cobrado.
  assert.equal(podeEnviarASeguradora('docs_pendentes'), false)
  assert.equal(podeEnviarASeguradora('rascunho'), false)
  assert.equal(podeEnviarASeguradora('enviada_seguradora'), false)
  assert.equal(podeEnviarASeguradora('aprovada'), false)
})

test('concluir pela decisão vale de documentos recebidos em diante, e só enquanto está aberta', () => {
  assert.equal(podeConcluirPelaDecisao('docs_recebidos'), true)
  assert.equal(podeConcluirPelaDecisao('enviada_seguradora'), true)
  assert.equal(podeConcluirPelaDecisao('em_analise'), true)
  // Antes disso não há o que concluir: a pasta ainda não foi conferida.
  assert.equal(podeConcluirPelaDecisao('docs_pendentes'), false)
  assert.equal(podeConcluirPelaDecisao('solicitada'), false)
  // E depois não há o que concluir de novo.
  assert.equal(podeConcluirPelaDecisao('aprovada'), false)
  assert.equal(podeConcluirPelaDecisao('negada'), false)
  assert.equal(podeConcluirPelaDecisao('cancelada'), false)
})

test('cada decisão tem um desfecho, e só "não operar" nega', () => {
  assert.equal(DESFECHO_DA_DECISAO.operar_com_cobertura, 'aprovada')
  // Sem cobertura é uma condição da operação, não uma reprovação: o limite foi dado.
  assert.equal(DESFECHO_DA_DECISAO.operar_sem_cobertura, 'aprovada')
  assert.equal(DESFECHO_DA_DECISAO.operar_limite_reduzido, 'aprovada_parcial')
  assert.equal(DESFECHO_DA_DECISAO.nao_operar, 'negada')

  for (const [decisao, estagio] of Object.entries(DESFECHO_DA_DECISAO)) {
    assert.equal(ehEstagioDecidido(estagio), true, decisao)
    assert.equal((estagio === 'negada') === (decisao === 'nao_operar'), true, decisao)
  }
})

test('a conclusão só aceita desfecho, nunca um estágio do meio da esteira', () => {
  assert.equal(concluirAnaliseSchema.safeParse({ id: ID, estagio: 'aprovada' }).success, true)
  assert.equal(concluirAnaliseSchema.safeParse({ id: ID, estagio: 'docs_recebidos' }).success, false)
  assert.equal(concluirAnaliseSchema.safeParse({ id: ID, estagio: 'cancelada' }).success, false)
  // O motivo é opcional aqui: quem exige motivo é o registro da decisão (0122), e
  // repetir a exigência faria a pessoa escrevê-lo duas vezes para o mesmo caso.
  const r = concluirAnaliseSchema.parse({ id: ID, estagio: 'negada' })
  assert.equal(r.motivo, undefined)
})
