import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assuntoDoEmail,
  briefingParaIa,
  brlCurto,
  direcaoDa,
  maiorVazamento,
  nomeDoArquivo,
  ritmoDoMes,
  textoDaRegua,
  textoDoRetrato,
  variacaoTexto,
  type IndicadorReport,
  type JanelaFunil,
  type PeriodoReport,
  type ReportSemanal,
} from './semanal.js'

const periodo: PeriodoReport = {
  inicio: '2026-08-31', fim: '2026-09-06', semana_iso: 36, ano: 2026,
  mes_inicio: '2026-09-01', mes_dias_decorridos: 6, mes_dias_total: 30,
  base_12m_de: '2025-10-01', base_12m_ate: '2026-09-01',
  retrato_em: '2026-09-06', retrato_carteira_em: '2026-09-06', ao_vivo: false,
  gerado_em: '2026-09-06T21:00:00Z',
}

const ind = (p: Partial<IndicadorReport> = {}): IndicadorReport => ({
  metrica: 'volume_convertido', unidade: 'brl', subir_e_pior: false,
  semana: 0, mes: 0, doze_total: 0, doze_media_mensal: null, doze_media_semanal: null,
  meses_com_dado: 0, var_semana_pct: null, var_mes_pct: null, ...p,
})

// ─── Direção: a metade dos indicadores em que crescer é ruim ────────────────

test('subir é melhor no volume e PIOR no que expirou', () => {
  assert.equal(direcaoDa(22, false), 'melhor')
  assert.equal(direcaoDa(22, true), 'pior')
  assert.equal(direcaoDa(-15, false), 'pior')
  // Cair no valor expirado é uma boa notícia, e a tela precisa dizer isso.
  assert.equal(direcaoDa(-15, true), 'melhor')
})

test('variação menor que 1% é ruído, não notícia', () => {
  assert.equal(direcaoDa(0.4, false), 'neutro')
  assert.equal(direcaoDa(-0.9, true), 'neutro')
})

test('sem régua não é "não variou" — são leituras opostas', () => {
  assert.equal(direcaoDa(null, false), 'sem_regua')
  assert.equal(direcaoDa(Number.NaN, false), 'sem_regua')
  assert.notEqual(direcaoDa(null, false), direcaoDa(0, false))
})

// ─── O texto da régua ───────────────────────────────────────────────────────

test('a régua diz quantos meses ela tem, e não finge que são doze', () => {
  assert.equal(textoDaRegua({ meses_com_dado: 3 }), 'média de 3 meses')
  assert.equal(textoDaRegua({ meses_com_dado: 1 }), 'média de 1 mês')
  assert.equal(textoDaRegua({ meses_com_dado: 0 }), 'sem base de comparação')
})

// ─── Mês parcial ────────────────────────────────────────────────────────────

test('o ritmo projeta o mês parcial, que é a única comparação honesta com a média', () => {
  // Seis dias com R$ 6 mi vão para R$ 30 mi no mês de trinta dias.
  assert.equal(ritmoDoMes(6_000_000, 6, 30), 30_000_000)
})

test('ritmo sem dias decorridos é null, e não uma divisão por zero', () => {
  assert.equal(ritmoDoMes(1000, 0, 30), null)
  assert.equal(ritmoDoMes(1000, 6, 0), null)
})

// ─── O maior vazamento ──────────────────────────────────────────────────────

const funil = (p: Partial<JanelaFunil> = {}): JanelaFunil => ({
  distribuidos: 0, contatados: 0, com_fit: 0, agendados: 0, realizados: 0, ganhos: 0,
  passagem: { contato_pct: null, fit_pct: null, agenda_pct: null, realiza_pct: null, ganho_pct: null },
  ...p,
})

test('o maior vazamento é o que perde mais GENTE, não a menor porcentagem', () => {
  /*
   * Este funil separa as duas leituras de propósito:
   *   com_fit 30 → agendados 3   perde 27, passa 10%   ← 27 pessoas que ninguém agendou
   *   agendados 3 → realizados 0 perde  3, passa  0%   ← a pior taxa da tabela
   * A régua percentual apontaria a segunda. A que faz alguém agir é a primeira.
   */
  const v = maiorVazamento(funil({
    distribuidos: 50, contatados: 30, com_fit: 30, agendados: 3, realizados: 0, ganhos: 0,
  }))
  assert.equal(v?.de, 'com_fit')
  assert.equal(v?.para, 'agendados')
  assert.equal(v?.perdidos, 27)
  assert.equal(v?.passagem_pct, 10)
})

test('etapa sem ninguém entrando não é vazamento — não passou água ali', () => {
  const v = maiorVazamento(funil({ distribuidos: 0, contatados: 0 }))
  assert.equal(v, null)
})

test('funil sem perda nenhuma não inventa um vazamento', () => {
  const v = maiorVazamento(funil({
    distribuidos: 5, contatados: 5, com_fit: 5, agendados: 5, realizados: 5, ganhos: 5,
  }))
  assert.equal(v, null)
})

test('o vazamento carrega a taxa de 12 meses, para separar crônico de novo', () => {
  const v = maiorVazamento(
    funil({ distribuidos: 10, contatados: 2 }),
    funil({ passagem: { contato_pct: 80, fit_pct: null, agenda_pct: null, realiza_pct: null, ganho_pct: null } }),
  )
  assert.equal(v?.passagem_pct, 20)
  assert.equal(v?.passagem_12m_pct, 80)
})

// ─── Assunto e nome do arquivo ──────────────────────────────────────────────

test('o assunto troca os marcadores conhecidos', () => {
  assert.equal(
    assuntoDoEmail('Semana {semana} de {ano} — {periodo}', periodo),
    'Semana 36 de 2026 — 31/08/26 a 06/09/26',
  )
})

test('marcador desconhecido fica como está, e não vira undefined na caixa de entrada', () => {
  assert.equal(assuntoDoEmail('Report {inexistente}', periodo), 'Report {inexistente}')
})

test('template vazio cai no padrão em vez de mandar e-mail sem assunto', () => {
  assert.match(assuntoDoEmail('', periodo), /^Report semanal ONE OS/)
  assert.match(assuntoDoEmail(null, periodo), /^Report semanal ONE OS/)
})

test('no PDF, o retrato diz que os estoques são do fim da janela', () => {
  const t = textoDoRetrato(periodo)
  assert.match(t, /Retrato de 06\/09\/26/)
  assert.match(t, /31\/08\/26 a 06\/09\/26/)
  assert.doesNotMatch(t, /AGORA/)
})

test('na tela, o retrato diz que os estoques são de agora — e de que dia é a carteira', () => {
  const t = textoDoRetrato({ ...periodo, ao_vivo: true, retrato_carteira_em: '2026-09-14' })
  assert.match(t, /AGORA \(14\/09\/26\)/)
  // A JANELA continua sendo a da semana mesmo ao vivo: é o que impede alguém de ler o
  // estoque de hoje como se fosse o fluxo de hoje.
  assert.match(t, /31\/08\/26 a 06\/09\/26/)
})

test('o retrato não formata com Date: a data ISO não pode andar um dia para trás', () => {
  // `new Date('2026-09-01')` é meia-noite UTC, que em São Paulo é 31/08 às 21h. O report do
  // dia 1º sairia carimbado com 31/08 — o erro clássico, e silencioso.
  assert.match(textoDoRetrato({ ...periodo, fim: '2026-09-01' }), /Retrato de 01\/09\/26/)
})

test('o nome do arquivo tem a semana com dois dígitos, para ordenar em qualquer pasta', () => {
  assert.equal(nomeDoArquivo(periodo), 'report-semanal-oneos-2026-S36.pdf')
  assert.equal(nomeDoArquivo({ ...periodo, semana_iso: 7 }), 'report-semanal-oneos-2026-S07.pdf')
})

// ─── Formatação ─────────────────────────────────────────────────────────────

/* `toLocaleString` do pt-BR separa o "R$" com espaço FINO NÃO SEPARÁVEL (U+00A0/U+202F),
   e não com o espaço do teclado. Comparar sem normalizar faz um teste falhar exibindo duas
   strings idênticas na tela — que é o pior tipo de teste vermelho. */
const semEspacoFino = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

test('o dinheiro encolhe sem perder a ordem de grandeza', () => {
  assert.equal(semEspacoFino(brlCurto(1_165_996_000)), 'R$ 1,2 bi')
  assert.equal(semEspacoFino(brlCurto(9_819_804)), 'R$ 9,8 mi')
  assert.equal(semEspacoFino(brlCurto(380_000)), 'R$ 380 mil')
  assert.equal(semEspacoFino(brlCurto(0)), 'R$ 0')
})

test('valor ausente é travessão, e nunca R$ 0 — são coisas diferentes', () => {
  assert.equal(brlCurto(null), '—')
  assert.equal(brlCurto(undefined), '—')
  assert.equal(brlCurto(Number.NaN), '—')
})

test('a variação leva sinal explícito quando sobe', () => {
  assert.equal(variacaoTexto(22.4), '+22,4%')
  assert.equal(variacaoTexto(-8), '-8%')
  assert.equal(variacaoTexto(null), '—')
})

// ─── O briefing do modelo ───────────────────────────────────────────────────

const vazio: ReportSemanal = {
  periodo,
  operacao: {
    kpis: {
      volume_convertido: ind(),
      vop_operado: ind({ metrica: 'vop_operado' }),
      receita: ind({ metrica: 'receita' }),
      limite_ocioso: {
        metrica: 'limite_ocioso', unidade: 'brl', subir_e_pior: true,
        foto: 0, em: '2026-09-06', sem_serie: true,
      },
    },
    antecipacao: {
      volume: ind(), vop: ind(), receita: ind(),
      operacoes_semana: 0, operacoes_mes: 0, cedentes_semana: 0, cedentes_mes: 0,
      ticket_medio_semana: null, ticket_medio_mes: null,
      prazo_medio_semana: null, prazo_medio_mes: null, prazo_medio_12m: null,
      top_cedentes: [],
    },
    nf: {
      capturadas: ind({ unidade: 'unidades' }),
      valor_capturado: ind(),
      valor_expirado: ind({ subir_e_pior: true }),
      por_faixa: [],
      travadas: { total: 0, valor: 0, itens: [] },
    },
  },
  comercial: {
    funil: {},
    comercial: {
      leads_semana: 0, leads_inbound: 0, leads_outbound: 0, fit_avaliados: 0, fit_pct: null,
      reunioes_agendadas: ind({ unidade: 'unidades' }), reunioes_realizadas: 0,
      no_shows_nao_remarcados: 0, mous: 0, ciclo_medio_dias: null, ciclo_medio_base: 0,
    },
    credito: {
      solicitadas_semana: 0, aprovadas_semana: 0, negadas_semana: 0,
      limite_concedido: ind(), aprovacao_pct: null,
      esteira_dias: null, esteira_base: 0, esteira_gargalo: null, divergencias_seguradora: 0,
    },
    time: { vendedores: [], filas: { inbound_sem_contato: 0, docs_parados: 0, conversas_sem_resposta: 0 } },
  },
  carteira: {
    carteira: {
      clientes: 0, operaram_semana: 0, limite_total: 0, limite_ocioso: 0,
      utilizacao_pct: null, inoperantes: 0, novos_semana: 0, sairam_semana: 0,
    },
    listas: { nao_performando: [], novos_clientes: [], sairam: [] },
    certificados: {
      cnpjs: 0, cobertos: 0, vencendo_30d: 0, sem_certificado: 0, cobertura_pct: null,
      matrizes: 0, matrizes_cobertas: 0, spes: 0, spes_cobertas: 0,
      invisivel: { razao: null, razao_base: 0, grupos_cegos: null, total_mes_do_topo: null, itens: [] },
    },
    atencao: {},
  },
}

test('período sem dado nenhum produz briefing, e não exceção', () => {
  // A primeira semana depois de instalar o sistema é exatamente este caso.
  const b = briefingParaIa(vazio)
  assert.equal((b.maior_vazamento as unknown), null)
  assert.equal((b.funil_semana as unknown), null)
  assert.deepEqual((b.volume_convertido as { direcao: string }).direcao, 'sem_regua')
})

test('o briefing leva SÓ números — nenhuma chave de item cru escapa para o modelo', () => {
  const b = briefingParaIa(vazio)
  const texto = JSON.stringify(b)
  // O modelo não pode receber id interno: ele cita o que recebe, e citar um uuid num
  // parágrafo executivo é o sintoma de que o briefing virou despejo de tabela.
  assert.ok(!texto.includes('access_key'))
  assert.ok(!texto.includes('id_externo'))
})

test('o briefing corta as listas: cinco itens bastam para um parágrafo', () => {
  const muitos = Array.from({ length: 40 }, (_, i) => ({ cedente: `C${i}`, volume: i }))
  const r = { ...vazio }
  r.operacao.antecipacao.top_cedentes = muitos
  const b = briefingParaIa(r)
  assert.equal((b.antecipacao as { maiores_cedentes: unknown[] }).maiores_cedentes.length, 5)
})
