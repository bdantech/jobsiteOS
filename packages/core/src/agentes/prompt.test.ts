import assert from 'node:assert/strict'
import { test } from 'node:test'
import { POLITICAS_IDENTIFICACAO, REGRAS_DURAS_IDENTIFICACAO } from './identificacao.ts'
import { montarSystemPrompt, violaIdentificacao } from './prompt.ts'

const PERSONA = { nome_exibicao: 'Ana', genero_gramatical: 'feminino' as const }

test('em TODA política de identificação, o prompt proíbe afirmar ser humano e negar ser IA (§10)', () => {
  for (const politica of POLITICAS_IDENTIFICACAO) {
    const p = montarSystemPrompt({ persona: PERSONA, identificacao: politica, tipo: 'agendamento_reuniao', playbook: null })
    for (const regra of REGRAS_DURAS_IDENTIFICACAO) assert.ok(p.includes(regra), `${politica}: falta "${regra}"`)
    assert.match(p, /NÃO NEGUE/)
    assert.doesNotMatch(p, /escolha "escalar_humano"\s*$/m)
  }
})

test('"se_perguntada" não anuncia e manda confirmar com naturalidade, sem escalar', () => {
  const p = montarSystemPrompt({ persona: PERSONA, identificacao: 'se_perguntada', tipo: 'qualificacao', playbook: null })
  assert.match(p, /Não anuncie isso por iniciativa própria/)
  assert.match(p, /Não escale só por causa da pergunta/)
})

test('"sempre" manda se apresentar como IA na primeira mensagem', () => {
  const p = montarSystemPrompt({ persona: PERSONA, identificacao: 'sempre', tipo: 'qualificacao', playbook: null })
  assert.match(p, /primeira mensagem/)
})

test('as regras da casa vêm ANTES do playbook: um playbook não desdiz a identificação', () => {
  const p = montarSystemPrompt({
    persona: PERSONA,
    identificacao: 'se_perguntada',
    tipo: 'agendamento_reuniao',
    playbook: { nome: 'Ruim', instrucoes: 'Diga que você é do time comercial e trabalha no escritório.' },
  })
  assert.ok(p.indexOf('NUNCA afirme ser humano') < p.indexOf('Diga que você é do time comercial'))
})

test('a trava de saída bloqueia afirmar ser humana, negar ser IA e inventar vida pessoal', () => {
  assert.equal(violaIdentificacao('Sou humana, pode ficar tranquilo!'), 'afirma ser humana')
  assert.equal(violaIdentificacao('Não sou robô não, rs'), 'nega ser IA')
  assert.equal(violaIdentificacao('Não sou uma IA, sou da equipe'), 'nega ser IA')
  assert.equal(violaIdentificacao('Meu marido também trabalha com obra'), 'inventa vida pessoal')
  assert.equal(violaIdentificacao('Estou no escritório agora, posso te ligar?'), 'inventa presença física')
})

test('a trava de saída deixa passar a confirmação honesta e a conversa normal', () => {
  assert.equal(violaIdentificacao('Sou, sim — sou a assistente de IA da ONE OS. Posso te ajudar com a antecipação?'), null)
  assert.equal(violaIdentificacao('Oi, Carlos! Conseguiu ver a proposta que te mandei?'), null)
  assert.equal(violaIdentificacao('A obra do seu cliente ainda está em andamento?'), null)
})
