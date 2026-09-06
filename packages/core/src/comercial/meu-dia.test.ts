import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CATALOGO_MEU_DIA,
  blocoCatalogado,
  blocosDoCargo,
  cargoDeVisao,
  composicaoDoDia,
  itensUrgentes,
  ordenarItens,
  projetarComissao,
  resolverConfig,
  totalDeItens,
  valorEmJogo,
  type ItemMeuDia,
  type MeuDia,
} from './meu-dia.ts'
import type { CommissionParam } from './comissao-v2.ts'

/**
 * O catálogo é a fonte da verdade de três coisas ao mesmo tempo (agregador, tela,
 * settings). Estes testes existem para que uma entrada torta seja pega aqui e não
 * como um bloco que aparece na tela e não aparece nas settings.
 */

function item(p: Partial<ItemMeuDia> = {}): ItemMeuDia {
  return {
    referencia_id: 'r1', titulo: 'Empresa', subtitulo: null, motivo: 'porque sim',
    valor: 100, urgencia: 'media', dias: 1, empresa_id: null, quando: null, meta: {},
    ...p,
  }
}

function dia(blocos: MeuDia['blocos']): MeuDia {
  return {
    tem_acesso: true, vendedor_id: 'v1', vendedor_nome: 'Alguém', tipo: 'vendedor',
    espelhado: false, gerado_em: '2026-09-06T12:00:00Z', blocos,
    mapa_carteira: [], evolucao: [], funil_semana: [],
  }
}

// ─── Catálogo ───────────────────────────────────────────────────────────────

test('todo bloco do catálogo tem pelo menos um cargo', () => {
  for (const b of CATALOGO_MEU_DIA) {
    assert.ok(b.cargos.length > 0, `${b.tipo} não é de ninguém`)
  }
})

test('não há tipo de bloco repetido', () => {
  const vistos = new Set<string>()
  for (const b of CATALOGO_MEU_DIA) {
    assert.equal(vistos.has(b.tipo), false, `${b.tipo} duplicado`)
    vistos.add(b.tipo)
  }
})

test('todo limiar do catálogo tem rótulo para a tela de settings', () => {
  for (const b of CATALOGO_MEU_DIA) {
    for (const chave of Object.keys(b.limiaresPadrao)) {
      assert.ok(b.limiarRotulos?.[chave], `${b.tipo}.${chave} sem rótulo`)
    }
  }
})

test('o auxiliar do closer vê o dia do closer, e não um dia próprio', () => {
  assert.equal(cargoDeVisao('auxiliar'), 'vendedor')
  assert.deepEqual(
    blocosDoCargo('auxiliar').map((b) => b.tipo),
    blocosDoCargo('vendedor').map((b) => b.tipo),
  )
})

test('quem não é vendedor de nenhum tipo não tem blocos', () => {
  assert.equal(cargoDeVisao(null), null)
  assert.deepEqual(blocosDoCargo(null), [])
  assert.deepEqual(blocosDoCargo('gestor'), [])
})

// ─── Config ─────────────────────────────────────────────────────────────────

test('sem override, a config resolvida é o catálogo do cargo', () => {
  const cfg = resolverConfig('sdr', null)
  const bloco = blocoCatalogado('inbound_nao_contatado')!
  assert.equal(cfg.inbound_nao_contatado!.ativo, true)
  assert.equal(cfg.inbound_nao_contatado!.max_itens, bloco.maxPadrao)
  assert.deepEqual(cfg.inbound_nao_contatado!.limiares, bloco.limiaresPadrao)
  // Bloco de outro cargo não entra — é o que deixa o agregador tratar ausência como "não é seu".
  assert.equal(cfg.carteira_ociosa, undefined)
})

test('o override troca só o que ele nomeia, e o resto continua o padrão', () => {
  const cfg = resolverConfig('vendedor', {
    carteira_ociosa: { limiares: { dias_sem_antecipar: 45 } },
  })
  assert.equal(cfg.carteira_ociosa!.limiares.dias_sem_antecipar, 45)
  // O outro limiar do mesmo bloco sobrevive.
  assert.equal(cfg.carteira_ociosa!.limiares.limite_minimo, 50000)
  assert.equal(cfg.carteira_ociosa!.ativo, true)
})

test('bloco desligado continua na config — desligado, e não ausente', () => {
  const cfg = resolverConfig('vendedor', { novos_clientes: { ativo: false } })
  assert.equal(cfg.novos_clientes!.ativo, false)
})

test('teto de itens nunca desce abaixo de 1', () => {
  const cfg = resolverConfig('sdr', { no_shows: { max_itens: 0 } })
  assert.equal(cfg.no_shows!.max_itens, 1)
})

// ─── Leitura do dia ─────────────────────────────────────────────────────────

test('a ordem é urgência primeiro, valor depois', () => {
  const ordenados = ordenarItens([
    item({ referencia_id: 'barato-urgente', valor: 10, urgencia: 'alta' }),
    item({ referencia_id: 'caro-tranquilo', valor: 1_000_000, urgencia: 'baixa' }),
    item({ referencia_id: 'caro-urgente', valor: 5000, urgencia: 'alta' }),
  ])
  // O que vence hoje vem antes do que é caro: o urgente some sozinho se ninguém tocar.
  assert.deepEqual(ordenados.map((i) => i.referencia_id), [
    'caro-urgente', 'barato-urgente', 'caro-tranquilo',
  ])
})

test('R$ em jogo soma o valor dos blocos, e item sem valor não inventa número', () => {
  const d = dia([
    { tipo: 'carteira_ociosa', itens: [item({ valor: 1000 })], total: 1, valor_total: 1000 },
    { tipo: 'conversas_aguardando_resposta', itens: [item({ valor: null })], total: 1, valor_total: 0 },
  ])
  assert.equal(valorEmJogo(d), 1000)
  assert.equal(totalDeItens(d), 2)
})

test('a composição agrupa os blocos nas fatias do gráfico, e some quando vazia', () => {
  const d = dia([
    { tipo: 'carteira_ociosa', itens: [item(), item()], total: 2, valor_total: 200 },
    { tipo: 'analises_expirando', itens: [item()], total: 1, valor_total: 50 },
    { tipo: 'novos_clientes', itens: [], total: 0, valor_total: 0 },
  ])
  const c = composicaoDoDia(d)
  assert.deepEqual(c, [
    { grupo: 'carteira', itens: 2, valor: 200 },
    { grupo: 'credito', itens: 1, valor: 50 },
  ])
})

test('urgentes são só os de relógio correndo', () => {
  const d = dia([
    { tipo: 'leads_sla', itens: [item({ urgencia: 'alta' }), item({ urgencia: 'baixa' })], total: 2, valor_total: 0 },
  ])
  assert.equal(itensUrgentes(d).length, 1)
})

// ─── Comissão projetada ─────────────────────────────────────────────────────

const PARAMS: CommissionParam[] = [
  { id: '1', chave: 'dias_referencia_vop', vendedor_id: null, valor: 30, unidade: 'DAYS', vigente_de: '2026-01-01', vigente_ate: null },
  { id: '2', chave: 'vend_prospeccao_ativa_crescimento', vendedor_id: null, valor: 1000, unidade: 'BRL_PER_MM', vigente_de: '2026-01-01', vigente_ate: null },
  { id: '3', chave: 'orig_prospeccao_ativa', vendedor_id: null, valor: 600, unidade: 'BRL_PER_MM', vigente_de: '2026-01-01', vigente_ate: null },
  { id: '4', chave: 'fase_crescimento_prospeccao_ativa_meses', vendedor_id: null, valor: 6, unidade: 'MONTHS', vigente_de: '2026-01-01', vigente_ate: null },
  { id: '5', chave: 'sunset_vendedor_prospeccao_ativa_meses', vendedor_id: null, valor: 24, unidade: 'MONTHS', vigente_de: '2026-01-01', vigente_ate: null },
]

const HOJE = '2026-03-10T12:00:00Z'

test('a projeção usa o motor de verdade: mesmo VOP, mesma taxa, mesma fase', () => {
  // 500k × 45/30 = 750k de VOP → 0,75 MM × R$ 1.000 = R$ 750.
  const total = projetarComissao(
    [{ valor: 500_000, dias: 45, gestaoOperacao: 'prospeccao_ativa', marcoAtivacao: '2026-01-05', souVendedor: true, souOriginador: false }],
    PARAMS, 'vend-1', HOJE,
  )
  assert.equal(total, 750)
})

test('projeta os dois papéis quando a pessoa titulariza os dois lados', () => {
  const total = projetarComissao(
    [{ valor: 500_000, dias: 45, gestaoOperacao: 'prospeccao_ativa', marcoAtivacao: '2026-01-05', souVendedor: true, souOriginador: true }],
    PARAMS, 'vend-1', HOJE,
  )
  assert.equal(total, 1200) // 750 do vendedor + 450 do originador.
})

test('não projeta comissão de conta que não é minha', () => {
  const total = projetarComissao(
    [{ valor: 500_000, dias: 45, gestaoOperacao: 'prospeccao_ativa', marcoAtivacao: '2026-01-05', souVendedor: false, souOriginador: false }],
    PARAMS, 'vend-1', HOJE,
  )
  assert.equal(total, 0)
})

test('conta em residual não projeta nada para o vendedor', () => {
  const total = projetarComissao(
    [{ valor: 500_000, dias: 45, gestaoOperacao: 'prospeccao_ativa', marcoAtivacao: '2020-01-01', souVendedor: true, souOriginador: false }],
    PARAMS, 'vend-1', HOJE,
  )
  assert.equal(total, 0)
})

test('sem classificação da conta não há taxa possível, e a projeção é zero', () => {
  const total = projetarComissao(
    [{ valor: 500_000, dias: 45, gestaoOperacao: null, marcoAtivacao: '2026-01-05', souVendedor: true, souOriginador: false }],
    PARAMS, 'vend-1', HOJE,
  )
  assert.equal(total, 0)
})

test('a projeção soma vários itens e respeita o share', () => {
  const total = projetarComissao(
    [
      { valor: 500_000, dias: 45, gestaoOperacao: 'prospeccao_ativa', marcoAtivacao: '2026-01-05', souVendedor: true, souOriginador: false },
      { valor: 500_000, dias: 45, gestaoOperacao: 'prospeccao_ativa', marcoAtivacao: '2026-01-05', souVendedor: true, souOriginador: false, sharePct: 50 },
    ],
    PARAMS, 'vend-1', HOJE,
  )
  assert.equal(total, 1125) // 750 + 375.
})
