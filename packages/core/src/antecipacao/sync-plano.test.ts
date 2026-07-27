import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONFIG_SYNC_PADRAO } from './schemas.ts'
import { fatiarJanela, montarPlanoSync, querystringSync } from './sync-plano.ts'

/**
 * Estes testes existem porque a primeira versão do sync ERROU o contrato do
 * endpoint em três frentes ao mesmo tempo: nomes de parâmetro (`period.startDate`
 * em vez de `start_date`), semântica (tratava o filtro de EMISSÃO como se fosse de
 * sincronização) e limites (mandava 60 dias num filtro que aceita 10). Nenhuma
 * delas quebra typecheck. Todas quebram em produção.
 *
 * O que está travado aqui é o contrato:
 *   sync_hours ∈ [1,4], SUBSTITUI as datas (os dois juntos → 400)
 *   start_date/end_date por EMISSÃO, no máximo 10 dias, inclusivos
 */

const AGORA = new Date('2026-07-27T12:00:00Z')
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000)
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 86_400_000)

// ─── Incremental: é o `sync_hours`, que é a pergunta certa ──────────────────

test('gap dentro do teto vira sync_hours, sem filtro de datas', () => {
  const p = montarPlanoSync({ modo: 'incremental', ultimoSync: horasAtras(4), agora: AGORA })
  assert.equal(p.modo, 'incremental')
  assert.deepEqual(p.requisicoes, [{ tipo: 'sync_hours', horas: 4 }])
})

test('o arredondamento para cima é o colchão possível', () => {
  // Gap de 3h05 → pede 4h de sincronizadas. É a única folga que o teto permite.
  const p = montarPlanoSync({ modo: 'incremental', ultimoSync: horasAtras(3.08), agora: AGORA })
  assert.deepEqual(p.requisicoes, [{ tipo: 'sync_hours', horas: 4 }])
})

test('gap minúsculo ainda pede 1 hora (o mínimo do endpoint)', () => {
  const p = montarPlanoSync({ modo: 'incremental', ultimoSync: horasAtras(0.1), agora: AGORA })
  assert.deepEqual(p.requisicoes, [{ tipo: 'sync_hours', horas: 1 }])
})

test('sync_hours NUNCA passa de 4, mesmo com config errada', () => {
  const p = montarPlanoSync({
    modo: 'incremental',
    ultimoSync: horasAtras(4),
    agora: AGORA,
    cfg: { ...CONFIG_SYNC_PADRAO, sync_horas_max: 4 },
  })
  const req = p.requisicoes[0]
  assert.equal(req?.tipo, 'sync_hours')
  assert.ok(req?.tipo === 'sync_hours' && req.horas >= 1 && req.horas <= 4)
})

// ─── Recuperação: o buraco que o teto de 4h não alcança ─────────────────────

test('gap acima do teto cai para a janela por emissão', () => {
  // Uma corrida falhou: 9h desde o último sucesso. `sync_hours` não chega lá.
  const p = montarPlanoSync({ modo: 'incremental', ultimoSync: horasAtras(9), agora: AGORA })
  assert.equal(p.modo, 'recuperacao')
  assert.ok(p.requisicoes.every((r) => r.tipo === 'datas'))
  assert.match(p.descricao, /excede o teto/)
})

test('primeira execução usa a janela inicial, fatiada', () => {
  const p = montarPlanoSync({ modo: 'incremental', ultimoSync: null, agora: AGORA })
  assert.equal(p.modo, 'recuperacao')
  // 60 dias em blocos de 10 → 7 requisições (o bloco final é parcial).
  assert.equal(p.requisicoes.length, 7)
  assert.ok(p.requisicoes.every((r) => r.tipo === 'datas'))
})

// ─── O limite de 10 dias, que é onde a primeira versão tomava 400 ───────────

test('nenhum bloco excede o intervalo máximo do endpoint', () => {
  const blocos = fatiarJanela(diasAtras(60), AGORA, 10)
  for (const b of blocos) {
    assert.equal(b.tipo, 'datas')
    if (b.tipo !== 'datas') continue
    const dias = (Date.parse(b.ate) - Date.parse(b.de)) / 86_400_000
    // Inclusivo nas duas pontas: 10 dias é D..D+9, ou seja, diferença de 9.
    assert.ok(dias <= 9, `bloco de ${dias + 1} dias — o endpoint recusa acima de 10`)
    assert.ok(dias >= 0, `bloco invertido: ${b.de} → ${b.ate}`)
  }
})

test('os blocos cobrem a janela inteira sem buraco e sem sobreposição', () => {
  const blocos = fatiarJanela(diasAtras(25), AGORA, 10)
  assert.ok(blocos.length > 1)
  for (let i = 1; i < blocos.length; i++) {
    const anterior = blocos[i - 1]
    const atual = blocos[i]
    if (anterior?.tipo !== 'datas' || atual?.tipo !== 'datas') continue
    const gap = (Date.parse(atual.de) - Date.parse(anterior.ate)) / 86_400_000
    assert.equal(gap, 1, `entre ${anterior.ate} e ${atual.de} há ${gap} dia(s) — buraco ou sobreposição`)
  }
})

test('janela de um dia é um bloco só', () => {
  const blocos = fatiarJanela(AGORA, AGORA, 10)
  assert.equal(blocos.length, 1)
  assert.deepEqual(blocos[0], { tipo: 'datas', de: '2026-07-27', ate: '2026-07-27' })
})

// ─── Varredura: a rede de segurança do diário ───────────────────────────────

test('a varredura ignora o último sync e revarre por emissão', () => {
  const p = montarPlanoSync({ modo: 'varredura', ultimoSync: horasAtras(1), agora: AGORA })
  assert.equal(p.modo, 'varredura')
  assert.ok(p.requisicoes.every((r) => r.tipo === 'datas'))
  // 30 dias em blocos de 10 → 4 (o último parcial).
  assert.equal(p.requisicoes.length, 4)
})

// ─── A querystring: os nomes e a exclusividade mútua ────────────────────────

test('sync_hours vai sozinho — sem start_date/end_date', () => {
  const qs = new URLSearchParams(querystringSync({ tipo: 'sync_hours', horas: 4 }, 1, 200))
  assert.equal(qs.get('sync_hours'), '4')
  assert.equal(qs.get('start_date'), null, 'combinar sync_hours com datas é 400')
  assert.equal(qs.get('end_date'), null, 'combinar sync_hours com datas é 400')
  assert.equal(qs.get('page'), '1')
  assert.equal(qs.get('page_size'), '200')
})

test('o filtro de datas usa os nomes do endpoint (snake_case) e não manda sync_hours', () => {
  const qs = new URLSearchParams(
    querystringSync({ tipo: 'datas', de: '2026-07-01', ate: '2026-07-10' }, 3, 50),
  )
  assert.equal(qs.get('start_date'), '2026-07-01')
  assert.equal(qs.get('end_date'), '2026-07-10')
  assert.equal(qs.get('sync_hours'), null, 'combinar datas com sync_hours é 400')
  assert.equal(qs.get('page'), '3')
  assert.equal(qs.get('page_size'), '50')
})

test('end_date nunca é anterior a start_date', () => {
  // O endpoint exige end_date ≥ start_date. Um bloco invertido seria 400.
  for (const dias of [1, 9, 10, 11, 30, 60]) {
    for (const req of fatiarJanela(diasAtras(dias), AGORA, 10)) {
      if (req.tipo !== 'datas') continue
      assert.ok(req.ate >= req.de, `${req.de} → ${req.ate} está invertido`)
    }
  }
})
