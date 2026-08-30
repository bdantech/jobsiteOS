import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  acaoDisponivel,
  aplicarGuardrails,
  decisaoAgenteSchema,
  proximoPassoDaCadencia,
  validarDecisao,
  type DecisaoAgente,
} from './agente.ts'
import { CONFIG_COMUNICACAO_PADRAO } from './schemas.ts'
import { triagemSchema, type Triagem } from './triagem.ts'

const cfg = CONFIG_COMUNICACAO_PADRAO

const PLAYBOOK = {
  acoes_permitidas: ['responder_agora', 'agendar_toque', 'escalar_humano', 'aguardar'],
  prazos: { silencio_dias: 3, max_tentativas: 4, desistir_apos_dias: 21 },
}

const decisao = (p: Partial<DecisaoAgente>): DecisaoAgente =>
  decisaoAgenteSchema.parse({
    acao: 'aguardar',
    quando: '2026-09-01T12:00:00.000Z',
    confianca: 0.9,
    justificativa: 'Ainda é cedo para insistir.',
    ...p,
  })

const triagem = (p: Partial<Triagem>): Triagem =>
  triagemSchema.parse({
    intencao: 'duvida',
    sentimento: 'neutro',
    urgencia: 'baixa',
    pedido_de_humano: false,
    dados_extraidos: {},
    resumo_curto: '—',
    fonte: 'modelo',
    ...p,
  })

test('o discador está declarado e desligado', () => {
  assert.equal(acaoDisponivel('ligar', cfg), false)
  assert.equal(acaoDisponivel('ligar', { ...cfg, agente: { ...cfg.agente, ligacao_habilitada: true } }), true)
  assert.equal(acaoDisponivel('responder_agora', cfg), true)
})

test('uma ação fora do playbook é recusada, por mais confiante que venha', () => {
  const r = validarDecisao(decisao({ acao: 'marcar_sem_interesse', confianca: 1 }), PLAYBOOK, cfg)
  assert.equal(r.valida, false)
  assert.equal(r.motivo, 'acao_fora_do_playbook')
})

test('uma ação desligada é recusada mesmo estando no playbook', () => {
  const pb = { ...PLAYBOOK, acoes_permitidas: [...PLAYBOOK.acoes_permitidas, 'ligar'] }
  assert.equal(validarDecisao(decisao({ acao: 'ligar' }), pb, cfg).motivo, 'acao_desligada')
})

test('confiança abaixo do mínimo cai fora — é o gatilho da cadência fixa', () => {
  assert.equal(validarDecisao(decisao({ confianca: 0.4 }), PLAYBOOK, cfg).motivo, 'confianca_baixa')
  assert.equal(validarDecisao(decisao({ confianca: 0.6 }), PLAYBOOK, cfg).valida, true)
})

test('responder sem texto e agendar sem data são inválidos', () => {
  assert.equal(
    validarDecisao(decisao({ acao: 'responder_agora', conteudo_sugerido: '  ' }), PLAYBOOK, cfg).motivo,
    'falta_conteudo',
  )
  assert.equal(
    validarDecisao(decisao({ acao: 'agendar_toque', quando: null }), PLAYBOOK, cfg).motivo,
    'falta_quando',
  )
})

test('a decisão válida passa', () => {
  const d = decisao({ acao: 'responder_agora', conteudo_sugerido: 'Oi, Ana! Conseguiu ver?' })
  assert.deepEqual(validarDecisao(d, PLAYBOOK, cfg), { valida: true })
})

test('"você é um robô?" impede o agente de decidir e escala', () => {
  const r = aplicarGuardrails(
    { modo: 'autonomo', triagemDaUltima: triagem({}), corpoDaUltima: 'isso é um robô?', enviadasNaThreadHoje: 0, tentativas: 0 },
    PLAYBOOK,
    cfg,
  )
  assert.equal(r.podeDecidir, false)
  assert.equal(r.escalar, true)
})

test('menção a taxa escala antes de qualquer decisão', () => {
  const r = aplicarGuardrails(
    { modo: 'autonomo', triagemDaUltima: triagem({}), corpoDaUltima: 'qual a taxa?', enviadasNaThreadHoje: 0, tentativas: 0 },
    PLAYBOOK,
    cfg,
  )
  assert.equal(r.escalar, true)
})

test('o kill switch para o autônomo e deixa a sugestão viva', () => {
  const comKill = { ...cfg, agente: { ...cfg.agente, kill_switch: true } }
  const ctx = { triagemDaUltima: null, corpoDaUltima: null, enviadasNaThreadHoje: 0, tentativas: 0 }
  assert.equal(aplicarGuardrails({ ...ctx, modo: 'autonomo' }, PLAYBOOK, comKill).podeDecidir, false)
  assert.equal(aplicarGuardrails({ ...ctx, modo: 'sugestao' }, PLAYBOOK, comKill).podeDecidir, true)
})

test('modo desligado não decide e não escala', () => {
  const r = aplicarGuardrails(
    { modo: 'desligado', triagemDaUltima: null, corpoDaUltima: null, enviadasNaThreadHoje: 0, tentativas: 0 },
    PLAYBOOK,
    cfg,
  )
  assert.deepEqual([r.podeDecidir, r.escalar], [false, false])
})

test('o máximo de tentativas do playbook e o teto da thread param o agente', () => {
  const ctx = { modo: 'autonomo' as const, triagemDaUltima: null, corpoDaUltima: null, enviadasNaThreadHoje: 0, tentativas: 4 }
  assert.equal(aplicarGuardrails(ctx, PLAYBOOK, cfg).podeDecidir, false)
  assert.equal(
    aplicarGuardrails({ ...ctx, tentativas: 0, enviadasNaThreadHoje: 3 }, PLAYBOOK, cfg).podeDecidir,
    false,
  )
})

test('a cadência fixa é D0/D3/D7 e acaba dizendo "pare"', () => {
  const inicio = new Date('2026-08-27T12:00:00Z')
  const agora = new Date('2026-08-27T12:00:00Z')
  assert.equal(proximoPassoDaCadencia(0, inicio, agora, cfg)?.quando.toISOString(), '2026-08-27T12:00:00.000Z')
  assert.equal(proximoPassoDaCadencia(1, inicio, agora, cfg)?.quando.toISOString(), '2026-08-30T12:00:00.000Z')
  assert.equal(proximoPassoDaCadencia(2, inicio, agora, cfg)?.quando.toISOString(), '2026-09-03T12:00:00.000Z')
  // Acabou: parar também é um próximo passo.
  assert.equal(proximoPassoDaCadencia(3, inicio, agora, cfg), null)
})

test('uma etapa da cadência já vencida é feita agora, não no passado', () => {
  const inicio = new Date('2026-08-01T12:00:00Z')
  const agora = new Date('2026-08-27T12:00:00Z')
  assert.equal(proximoPassoDaCadencia(1, inicio, agora, cfg)?.quando.toISOString(), agora.toISOString())
})

test('o zod recusa uma ação que o modelo inventou', () => {
  assert.throws(() =>
    decisaoAgenteSchema.parse({ acao: 'mandar_flores', confianca: 1, justificativa: 'x' }),
  )
})
