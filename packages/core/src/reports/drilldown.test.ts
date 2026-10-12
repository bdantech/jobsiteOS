import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CHAVES_DETALHE,
  DETALHES,
  celulaDoDetalhe,
  colunasPresentes,
  csvDoDetalhe,
  detalheBate,
  esperadoNoReport,
  lerLinkDoDetalhe,
  linkDoDetalhe,
  medidaDoDetalhe,
  naturezaDoAlvo,
  nomeDoCsv,
  paginasDoDetalhe,
  type AlvoDetalhe,
} from './drilldown.js'
import type { ReportSemanal } from './semanal.js'

const CTX = { inicio: '2026-10-05', fim: '2026-10-11', retrato: '2026-10-12', params: {} }

/** Só os campos que `esperadoNoReport` lê. O resto do report não participa. */
const report = {
  periodo: { inicio: '2026-10-05', fim: '2026-10-11' },
  operacao: {
    kpis: {
      volume_convertido: { semana: 1_500_000.5 }, vop_operado: { semana: 900_000 },
      receita: { semana: 42_000 }, limite_ocioso: { foto: 59_700_000 },
    },
    nf: {
      capturadas: { semana: 812 }, valor_expirado: { semana: 300_000 },
      travadas: { total: 7 },
      por_faixa: [{ faixa: 'alta', entradas_semana: 31, entradas_12m: 420 }],
    },
  },
  comercial: {
    funil: { semana: { distribuidos: 98, contatados: 47, com_fit: 4, agendados: 5, realizados: 3, ganhos: 0 } },
    comercial: {
      fit_avaliados: 23, reunioes_realizadas: 32, no_shows_nao_remarcados: 1, mous: 0,
      ciclo_medio_base: 2,
    },
    time: { vendedores: [{ vendedor_id: 'v1', vop: 250_000 }] },
  },
  carteira: {
    listas: {
      nao_performando: [
        { gestor: 'Ana', ocioso: 100_000 }, { gestor: 'Ana', ocioso: 50_000 }, { gestor: null, ocioso: 70_000 },
      ],
    },
    certificados: {
      cobertos: 23, vencendo_30d: 2, sem_certificado: 1020,
      invisivel: { total_mes_do_topo: 33_700_000 },
    },
    atencao: { protestos_novos: 3 },
  },
  aquisicao: {
    inicio: '2026-10-05', fim: '2026-10-11', em_aberto: false, calculado_em: '2026-10-12T12:00:00Z',
    origens: [
      { origem: 'inbound', com_fit: 1, sem_fit: 19, nao_avaliado: 25, expirados_sem_avaliar: 0,
        agendadas: 9, realizadas: 12, canceladas: 0, remarcadas: 0, no_shows: 0, sem_captura: 7, sem_desfecho: 0 },
      { origem: 'outbound', com_fit: 3, sem_fit: 4, nao_avaliado: 46, expirados_sem_avaliar: 16,
        agendadas: 3, realizadas: 1, canceladas: 0, remarcadas: 0, no_shows: 0, sem_captura: 1, sem_desfecho: 0 },
    ],
  },
} as unknown as ReportSemanal

// ─── O catálogo ─────────────────────────────────────────────────────────────

test('toda chave tem título, regra, colunas e natureza declarada', () => {
  for (const chave of CHAVES_DETALHE) {
    const d = DETALHES[chave]
    assert.ok(d.titulo({}).length > 0, chave)
    assert.ok(d.regra(CTX).length > 0, chave)
    assert.ok(d.colunas.length > 0, chave)
    assert.ok(['coorte', 'janela', 'estoque'].includes(d.natureza), chave)
  }
})

test('o funil é coorte e a linha de estatísticas é janela — é o que o §1 declara', () => {
  assert.equal(naturezaDoAlvo({ chave: 'funil_etapa', params: { etapa: 'realizados' } }), 'coorte')
  assert.equal(naturezaDoAlvo({ chave: 'reunioes_realizadas' }), 'janela')
  assert.equal(naturezaDoAlvo({ chave: 'fit_avaliados' }), 'janela')
  assert.equal(naturezaDoAlvo({ chave: 'limite_ocioso' }), 'estoque')
})

test('em "Exige atenção", evento da semana é janela e fila acumulada é estoque', () => {
  assert.equal(naturezaDoAlvo({ chave: 'atencao', params: { item: 'protestos_novos' } }), 'janela')
  assert.equal(naturezaDoAlvo({ chave: 'atencao', params: { item: 'lotes_aguardando' } }), 'estoque')
})

// ─── O agregado de cada bloco, contra o qual a lista é conferida ────────────

test('cada número clicável tem um valor de referência no report', () => {
  const casos: [AlvoDetalhe, number][] = [
    [{ chave: 'volume_convertido' }, 1_500_000.5],
    [{ chave: 'vop_operado' }, 900_000],
    [{ chave: 'receita' }, 42_000],
    [{ chave: 'limite_ocioso' }, 59_700_000],
    [{ chave: 'funil_etapa', params: { etapa: 'realizados' } }, 3],
    [{ chave: 'fit_avaliados' }, 23],
    [{ chave: 'reunioes_realizadas' }, 32],
    [{ chave: 'no_shows' }, 1],
    [{ chave: 'mous' }, 0],
    [{ chave: 'ciclo' }, 2],
    [{ chave: 'nf_faixa', params: { faixa: 'alta', serie: 'semana' } }, 31],
    [{ chave: 'nf_faixa', params: { faixa: 'alta', serie: 'doze' } }, 420],
    [{ chave: 'nf_capturadas' }, 812],
    [{ chave: 'nf_expiradas' }, 300_000],
    [{ chave: 'nf_travadas' }, 7],
    [{ chave: 'contas_paradas' }, 3],
    [{ chave: 'carteira_gestor', params: { gestor: 'Ana' } }, 150_000],
    [{ chave: 'carteira_gestor', params: { gestor: 'Sem gestor' } }, 70_000],
    [{ chave: 'cert_balde', params: { balde: 'validos' } }, 23],
    [{ chave: 'cert_balde', params: { balde: 'vencendo' } }, 2],
    [{ chave: 'cert_topo' }, 33_700_000],
    [{ chave: 'time_vendedor', params: { vendedor_id: 'v1' } }, 250_000],
    [{ chave: 'atencao', params: { item: 'protestos_novos' } }, 3],
    [{ chave: 'aq_leads', params: { origem: 'inbound', fit: 'sem_fit' } }, 19],
    [{ chave: 'aq_leads', params: { origem: 'total', fit: 'nao_avaliado' } }, 71],
    [{ chave: 'aq_leads', params: { origem: 'outbound', fit: 'total' } }, 53],
    [{ chave: 'aq_leads', params: { origem: 'total', fit: 'total' } }, 98],
    [{ chave: 'aq_reunioes', params: { fato: 'realizada', origem: 'total' } }, 13],
    [{ chave: 'aq_reunioes', params: { fato: 'agendada', origem: 'inbound' } }, 9],
    [{ chave: 'aq_reunioes', params: { fato: 'sem_captura' } }, 8],
  ]
  const cobertas = new Set(casos.map(([a]) => a.chave))
  for (const chave of CHAVES_DETALHE) assert.ok(cobertas.has(chave), `sem caso para ${chave}`)
  for (const [alvo, esperado] of casos) {
    assert.equal(esperadoNoReport(report, alvo), esperado, JSON.stringify(alvo))
  }
})

test('o balde "sem certificado" exclui os que estão vencendo: os três somam o universo', () => {
  const soma = (['validos', 'vencendo', 'sem'] as const)
    .map((balde) => esperadoNoReport(report, { chave: 'cert_balde', params: { balde } }) ?? 0)
    .reduce((a, b) => a + b, 0)
  // 23 cobertos + 1020 sem (que já incluem os 2 vencendo) = 1043 CNPJs.
  assert.equal(soma, 23 + 1020)
})

test('o total de leads da Aquisição é o "Leads" do funil — a mesma coorte', () => {
  assert.equal(
    esperadoNoReport(report, { chave: 'aq_leads', params: { origem: 'total', fit: 'total' } }),
    esperadoNoReport(report, { chave: 'funil_etapa', params: { etapa: 'distribuidos' } }),
  )
})

test('alvo de outra semana não tem referência no report aberto — e não acusa divergência', () => {
  const alvo: AlvoDetalhe = { chave: 'aq_leads', params: {}, inicio: '2026-09-28', fim: '2026-10-04' }
  assert.equal(esperadoNoReport(report, alvo), null)
  assert.equal(detalheBate(null, 123), true)
})

test('report antigo, sem o bloco de Aquisição, não quebra', () => {
  const antigo = { ...report, aquisicao: undefined } as unknown as ReportSemanal
  assert.equal(esperadoNoReport(antigo, { chave: 'aq_leads', params: {} }), null)
})

test('divergência é bug, não arredondamento: um centavo já não bate', () => {
  assert.equal(detalheBate(1_500_000.5, 1_500_000.5), true)
  assert.equal(detalheBate(1_500_000.5, 1_500_000.51), false)
  assert.equal(detalheBate(32, 31), false)
  // Ruído de ponto flutuante abaixo do centavo não é divergência.
  assert.equal(detalheBate(0.1 + 0.2, 0.3), true)
})

test('valor em reais confere pela SOMA; contagem confere pelo TOTAL de linhas', () => {
  assert.equal(medidaDoDetalhe('volume_convertido', { total: 121, soma: 1_500_000.5 }), 1_500_000.5)
  assert.equal(medidaDoDetalhe('reunioes_realizadas', { total: 32, soma: 0 }), 32)
})

// ─── Deep link ──────────────────────────────────────────────────────────────

test('o link do PDF abre o report com o modal já aberto, e a volta devolve o mesmo alvo', () => {
  const alvo: AlvoDetalhe = { chave: 'aq_leads', params: { origem: 'inbound', fit: 'nao_avaliado' } }
  const url = linkDoDetalhe('https://app.oneos.com.br/', alvo, 'exec-1')
  assert.ok(url.startsWith('https://app.oneos.com.br/comercial/relatorios/semanal?'))
  const lido = lerLinkDoDetalhe(new URL(url).searchParams)
  assert.equal(lido.execucaoId, 'exec-1')
  assert.deepEqual(lido.alvo, alvo)
})

test('o link carrega a semana quando ela não é a do report', () => {
  const alvo: AlvoDetalhe = { chave: 'aq_reunioes', params: { fato: 'agendada' }, inicio: '2026-09-28', fim: '2026-10-04' }
  const lido = lerLinkDoDetalhe(new URL(linkDoDetalhe('https://x', alvo)).searchParams)
  assert.deepEqual(lido.alvo, alvo)
})

test('chave desconhecida na querystring não abre modal nenhum', () => {
  const lido = lerLinkDoDetalhe(new URLSearchParams('detalhe=drop_table&p.x=1'))
  assert.equal(lido.alvo, null)
})

// ─── Células, CSV e paginação ───────────────────────────────────────────────

test('data pura não atravessa fuso: 11/10 continua 11/10', () => {
  assert.equal(celulaDoDetalhe({ chave: 'vencimento', rotulo: 'V', tipo: 'data' }, '2026-10-11'), '11/10/2026')
  // Instante: 12/10 01:00 UTC ainda é 11/10 em São Paulo.
  assert.equal(celulaDoDetalhe({ chave: 'q', rotulo: 'Q', tipo: 'data' }, '2026-10-12T01:00:00Z'), '11/10/2026')
})

test('códigos do banco viram palavra na célula', () => {
  assert.equal(celulaDoDetalhe({ chave: 'origem', rotulo: 'Origem' }, 'distribuicao'), 'Outbound (distribuição)')
  assert.equal(celulaDoDetalhe({ chave: 'fit', rotulo: 'Fit' }, 'nao_avaliado'), 'Ainda não avaliado')
  assert.equal(celulaDoDetalhe({ chave: 'x', rotulo: 'X' }, null), '—')
})

test('o CSV usa ; e vírgula decimal, e escapa o que precisa', () => {
  const csv = csvDoDetalhe(
    [{ chave: 'empresa', rotulo: 'Empresa' }, { chave: 'valor', rotulo: 'Valor', tipo: 'brl' }],
    [{ empresa: 'ACME; "SA"', valor: 1234.5 }, { empresa: 'Beta', valor: null }],
  )
  assert.equal(csv, 'Empresa;Valor\r\n"ACME; ""SA""";1234,50\r\nBeta;')
})

test('só aparecem as colunas que a lista realmente tem', () => {
  const cols = colunasPresentes(DETALHES.atencao.colunas, [{ empresa: 'A', protestos: 2, quando: 'x' }])
  assert.deepEqual(cols.map((c) => c.chave), ['empresa', 'protestos', 'quando'])
})

test('50 por página, e a navegação para no teto configurado', () => {
  assert.deepEqual(paginasDoDetalhe(98, 5000), { paginas: 2, cortado: false })
  assert.deepEqual(paginasDoDetalhe(0, 5000), { paginas: 1, cortado: false })
  assert.deepEqual(paginasDoDetalhe(105_013, 5000), { paginas: 100, cortado: true })
})

test('o nome do arquivo diz o recorte e a semana', () => {
  assert.equal(
    nomeDoCsv({ chave: 'aq_leads', params: { origem: 'inbound', fit: 'sem_fit' } }, '2026-10-05'),
    'report-aq-leads-inbound-sem-fit-2026-10-05.csv',
  )
})
