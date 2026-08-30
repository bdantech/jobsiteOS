import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ehTransporteInterno,
  intervaloEntreEnvios,
  podeEnviar,
  tetoDiarioDaConta,
  type FatosDoEnvio,
} from './portao.ts'
import { CONFIG_COMUNICACAO_PADRAO } from './schemas.ts'

// Quinta-feira, 10h em São Paulo: dentro da janela padrão.
const AGORA = new Date('2026-08-27T13:00:00Z')

const BASE: FatosDoEnvio = {
  canal: 'whatsapp',
  tipoConta: 'relacionamento',
  automatica: false,
  suprimido: false,
  baseLegal: 'relacao_comercial',
  enviadasNaThreadHoje: 0,
  enviadasPelaContaHoje: 0,
  tetoDaConta: 200,
  ultimoToqueEm: null,
  agora: AGORA,
}

const cfg = CONFIG_COMUNICACAO_PADRAO

test('o caminho feliz passa', () => {
  assert.deepEqual(podeEnviar(BASE, cfg), { pode: true })
})

test('o kill switch só alcança o que é automático', () => {
  const comKill = { ...cfg, agente: { ...cfg.agente, kill_switch: true } }
  assert.equal(podeEnviar({ ...BASE, automatica: true }, comKill).motivo, 'kill_switch')
  // Uma pessoa apertando enviar continua enviando: o kill switch para os modos
  // autônomos, não a casa inteira.
  assert.equal(podeEnviar({ ...BASE, automatica: false }, comKill).pode, true)
})

test('supressão vence tudo, inclusive a confirmação explícita de um humano', () => {
  const r = podeEnviar({ ...BASE, suprimido: true, forcarJanela: true }, cfg)
  assert.equal(r.pode, false)
  assert.equal(r.motivo, 'suprimido')
})

test('contato sem base legal não é abordado', () => {
  assert.equal(podeEnviar({ ...BASE, baseLegal: null }, cfg).motivo, 'sem_base_legal')
})

test('o teto por thread barra a quarta mensagem do dia', () => {
  assert.equal(podeEnviar({ ...BASE, enviadasNaThreadHoje: 2 }, cfg).pode, true)
  assert.equal(podeEnviar({ ...BASE, enviadasNaThreadHoje: 3 }, cfg).motivo, 'teto_thread')
})

test('o teto da conta barra o número que já mandou o que aguenta', () => {
  assert.equal(podeEnviar({ ...BASE, enviadasPelaContaHoje: 20, tetoDaConta: 20 }, cfg).motivo, 'teto_conta')
})

test('cooldown conta o último toque, seja ele de máquina ou de gente', () => {
  const ontem = new Date(AGORA.getTime() - 86_400_000)
  assert.equal(podeEnviar({ ...BASE, ultimoToqueEm: ontem }, cfg).motivo, 'cooldown')
  const semanaPassada = new Date(AGORA.getTime() - 7 * 86_400_000)
  assert.equal(podeEnviar({ ...BASE, ultimoToqueEm: semanaPassada }, cfg).pode, true)
})

test('fora da janela é adiamento com hora marcada, não descarte', () => {
  const noite = new Date('2026-08-28T01:00:00Z') // 22h de quinta em SP
  const r = podeEnviar({ ...BASE, agora: noite }, cfg)
  assert.equal(r.pode, false)
  assert.equal(r.motivo, 'fora_da_janela')
  assert.ok(r.reagendarPara instanceof Date)
  assert.ok(r.reagendarPara!.getTime() > noite.getTime())
})

test('um humano pode furar a janela com confirmação', () => {
  const noite = new Date('2026-08-28T01:00:00Z')
  assert.equal(podeEnviar({ ...BASE, agora: noite, forcarJanela: true }, cfg).pode, true)
})

test('a recusa devolvida é a mais permanente, não a última encontrada', () => {
  const tudoErrado: FatosDoEnvio = {
    ...BASE,
    automatica: true,
    suprimido: true,
    baseLegal: null,
    enviadasNaThreadHoje: 99,
    enviadasPelaContaHoje: 999,
    ultimoToqueEm: AGORA,
    agora: new Date('2026-08-29T15:00:00Z'), // sábado
  }
  const comKill = { ...cfg, agente: { ...cfg.agente, kill_switch: true } }
  assert.equal(podeEnviar(tudoErrado, comKill).motivo, 'kill_switch')
  assert.equal(podeEnviar(tudoErrado, cfg).motivo, 'suprimido')
})

test('o plantão interno não passa pelo portão de mercado', () => {
  assert.equal(ehTransporteInterno({ canal: 'interno', tipoConta: 'relacionamento' }), true)
  assert.equal(ehTransporteInterno({ canal: 'whatsapp', tipoConta: 'plantao' }), true)

  const alerta: FatosDoEnvio = {
    ...BASE,
    tipoConta: 'plantao',
    automatica: true,
    suprimido: true,
    baseLegal: null,
    agora: new Date('2026-08-29T02:00:00Z'), // sábado, 23h de sexta em SP
  }
  // Um orçamento estourado precisa avisar às 23h de sexta. É o ponto do §1.5.
  assert.equal(podeEnviar(alerta, { ...cfg, agente: { ...cfg.agente, kill_switch: true } }).pode, true)
})

test('a rampa de warmup sobe por semana e nunca passa do teto da conta', () => {
  const hoje = new Date('2026-08-27T00:00:00Z')
  const nova = (inicio: string | null) => ({ mensagens_por_dia: 200, warmup_iniciado_em: inicio })

  // Conta sem warmup registrado é conta já aquecida.
  assert.equal(tetoDiarioDaConta(nova(null), cfg, hoje), 200)
  // Dia 1: 20/dia.
  assert.equal(tetoDiarioDaConta(nova('2026-08-27'), cfg, hoje), 20)
  // Sexto dia ainda é a primeira semana.
  assert.equal(tetoDiarioDaConta(nova('2026-08-22'), cfg, hoje), 20)
  // Segunda semana: 40.
  assert.equal(tetoDiarioDaConta(nova('2026-08-20'), cfg, hoje), 40)
  // Meses depois, o teto da conta é o limite — a rampa não o ultrapassa.
  assert.equal(tetoDiarioDaConta(nova('2025-01-01'), cfg, hoje), 200)
})

test('o intervalo entre envios fica dentro da faixa configurada', () => {
  const conta = { intervalo_min_seg: 25, intervalo_max_seg: 70 }
  assert.equal(intervaloEntreEnvios(conta, () => 0), 25_000)
  assert.equal(intervaloEntreEnvios(conta, () => 1), 70_000)
  assert.equal(intervaloEntreEnvios(conta, () => 0.5), 47_500)
  // Faixa invertida por engano na config não produz intervalo negativo.
  assert.equal(intervaloEntreEnvios({ intervalo_min_seg: 70, intervalo_max_seg: 10 }, () => 0.5), 70_000)
})
