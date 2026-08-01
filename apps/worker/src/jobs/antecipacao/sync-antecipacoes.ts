import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { formatarMoeda } from '../../../../../packages/core/src/antecipacao/economia.js'
import {
  extrairAntecipacoes,
  normalizarAntecipacaoPayload,
  totalDePaginasAntecipacoes,
  type AntecipacaoNormalizada,
  type AntecipacaoPayload,
  type RespostaAntecipacoes,
} from '../../../../../packages/core/src/antecipacao/antecipacao-payload.js'
import {
  casarAntecipacao,
  MOTIVO_MATCH_LABELS,
  type CandidataNf,
  type ResultadoMatch,
} from '../../../../../packages/core/src/antecipacao/matching.js'
import {
  statusConverte,
  type ConfigConversao,
} from '../../../../../packages/core/src/antecipacao/schemas.js'
import type { TablesInsert } from '../../../../../packages/core/src/types/database.js'
import { lerConfigConversao } from '../../antecipacao/config.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'
import { emitirEvento, notificarPerfis } from '../../radar/eventos.js'

/**
 * Sync de antecipações + conversão automática de NFs (04e).
 *
 * Fecha o loop do funil. Até aqui `convertida` só existia por clique humano — 5
 * notas em 15.870 — e a métrica por faixa media intenção, não receita. Agora a
 * antecipação REALIZADA na plataforma é quem marca a nota.
 *
 * Três decisões governam o arquivo inteiro:
 *
 * 1. PRECISÃO ACIMA DE RECALL. O motor de casamento vive no core, é puro e tem
 *    teste; aqui só entram as candidatas e saem os efeitos. Ambiguidade nunca
 *    vira conversão: vai para `revisao`, que é uma fila com nome e dono.
 *
 * 2. IDEMPOTÊNCIA POR id_externo. A janela de 3 dias por data de CRIAÇÃO se
 *    sobrepõe de propósito: o filtro do endpoint é por criação, então recapturar
 *    os últimos dias é o que faz uma mudança de status (criada anteontem,
 *    aprovada hoje) chegar como UPDATE da mesma linha.
 *
 * 3. REGRESSÃO NÃO SE DESFAZ SOZINHA. Se uma antecipação já convertida volta
 *    atrás, a nota continua convertida e ganha uma flag de disputa (§4.5).
 *    Reverter em silêncio seria a máquina apagando receita sem que ninguém visse.
 */

export interface ResultadoSyncAntecipacoes {
  janela: string
  paginas: number
  antecipacoes: number
  novas: number
  atualizadas: number
  ignoradas: number
  status_alterados: number
  casadas: number
  sem_nf: number
  revisao: number
  convertidas: number
  regressoes: number
  eventos: number
}

export interface ResultadoRematch {
  tentadas: number
  casadas: number
  convertidas: number
  ainda_sem_nf: number
  definitivas: number
  eventos: number
}

// ─── O endpoint ─────────────────────────────────────────────────────────────

/**
 * O caminho do recurso. O Prompt dá `{ONEPAY_BI_URL}/api/v1/anticipations`.
 *
 * Continua sendo default e não constante: se o recurso mudar de caminho, a
 * correção é `ONEPAY_ANTECIPACOES_URL` com a URL completa, sem deploy.
 */
const CAMINHO_PADRAO = '/api/v1/anticipations'

function urlBase(): string {
  const bruta = (env.ONEPAY_ANTECIPACOES_URL ?? env.ONEPAY_BI_URL ?? '').replace(/\/+$/, '')
  return /\/api\//.test(bruta) ? bruta : `${bruta}${CAMINHO_PADRAO}`
}

function autorizacao(): Record<string, string> {
  const token = env.ONEPAY_NF_TOKEN ?? env.ONEPAY_BI_TOKEN
  return token ? { authorization: `Bearer ${token}` } : {}
}

const PAGE_SIZE = 200

/**
 * A querystring do período.
 *
 * `start_date` / `end_date` e `page_size` são o MESMO vocabulário do endpoint de
 * NFs — e não é chute: o envelope da resposta descrito no Prompt (`page`,
 * `pageSize`, `totalPages`, `period`) é exatamente o de `/api/v1/invoices`, que
 * já está mapeado e testado. Mesma API, mesma convenção.
 *
 * A diferença que importa é o SIGNIFICADO das datas: lá elas filtram por emissão
 * da nota, aqui por CRIAÇÃO da antecipação.
 */
function querystring(de: string, ate: string, page: number): string {
  return new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
    start_date: de,
    end_date: ate,
  }).toString()
}

function dia(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ─── O sync ─────────────────────────────────────────────────────────────────

export async function sincronizarAntecipacoes(
  diasJanela?: number,
): Promise<ResultadoSyncAntecipacoes> {
  if (!env.ONEPAY_ANTECIPACOES_URL && !env.ONEPAY_BI_URL) {
    throw new Error(
      'Nenhuma URL do Onepay configurada. Defina ONEPAY_BI_URL (a mesma do sync de NFs) ou, ' +
        'se o recurso de antecipações estiver em outro caminho, ONEPAY_ANTECIPACOES_URL com a URL completa.',
    )
  }

  const cfg = await lerConfigConversao()
  const dias = diasJanela ?? cfg.janela_sync_dias
  const agora = new Date()
  const de = dia(new Date(agora.getTime() - dias * 86_400_000))
  const ate = dia(agora)
  const base = urlBase()

  const acc: ResultadoSyncAntecipacoes = {
    janela: `${de} → ${ate} (por criação)`,
    paginas: 0,
    antecipacoes: 0,
    novas: 0,
    atualizadas: 0,
    ignoradas: 0,
    status_alterados: 0,
    casadas: 0,
    sem_nf: 0,
    revisao: 0,
    convertidas: 0,
    regressoes: 0,
    eventos: 0,
  }

  logger.info({ janela: acc.janela, base }, 'Sync de antecipações iniciado.')

  let page = 1
  for (;;) {
    const resp = await requisitarJson<RespostaAntecipacoes>(
      `${base}?${querystring(de, ate, page)}`,
      { headers: autorizacao(), timeoutMs: 120_000 },
    )

    const itens = extrairAntecipacoes(resp)
    acc.paginas++

    for (const item of itens) {
      await processar(item, cfg, acc)
    }

    const totalPaginas = totalDePaginasAntecipacoes(resp)
    const acabou =
      itens.length === 0 ||
      itens.length < PAGE_SIZE ||
      (typeof totalPaginas === 'number' && page >= totalPaginas)
    if (acabou) break
    page++
  }

  logger.info(acc, 'Sync de antecipações concluído.')
  return acc
}

interface LinhaAnterior {
  status: string
  match_status: string
  access_key_casada: string | null
  convertida_em: string | null
  invoice_cancelled_at: string | null
}

async function processar(
  item: AntecipacaoPayload,
  cfg: ConfigConversao,
  acc: ResultadoSyncAntecipacoes,
): Promise<void> {
  const r = normalizarAntecipacaoPayload(item)
  if (!r.ok) {
    logger.warn({ id: r.id, motivo: r.motivo }, 'Antecipação descartada no sync.')
    acc.ignoradas++
    return
  }
  const a = r.antecipacao
  acc.antecipacoes++

  const { data: anterior } = await supabaseAdmin
    .from('antecipacoes')
    .select('status, match_status, access_key_casada, convertida_em, invoice_cancelled_at')
    .eq('id_externo', a.id_externo)
    .maybeSingle<LinhaAnterior>()

  const mudouStatus = anterior !== null && anterior.status !== a.status

  const linha: TablesInsert<'antecipacoes'> = {
    id_externo: a.id_externo,
    status: a.status,
    // Só quando muda: reescrever `status_anterior` com o valor atual a cada
    // passagem apagaria a única memória do que a antecipação era antes.
    status_anterior: mudouStatus ? anterior.status : (undefined as never),
    anticipation_type: a.anticipation_type,
    document_number: a.document_number,
    numero_normalizado: a.numero_normalizado,
    sacado_cnpj: a.sacado_cnpj,
    fornecedor_cnpj: a.fornecedor_cnpj,
    sacado_nome: a.sacado_nome,
    fornecedor_nome: a.fornecedor_nome,
    request_date: a.request_date,
    created_at_plataforma: a.created_at_plataforma,
    original_due_date: a.original_due_date,
    completion_date: a.completion_date,
    anticipation_days: a.anticipation_days,
    gross_value: a.gross_value,
    withhold_tax: a.withhold_tax,
    discounted_amount: a.discounted_amount,
    net_value: a.net_value,
    total_spread: a.total_spread,
    monthly_interest_rate: a.monthly_interest_rate,
    approval_with_automation: a.approval_with_automation,
    invoice_cancelled_at: a.invoice_cancelled_at,
    raw: item as never,
    sincronizada_em: new Date().toISOString(),
    atualizada_em: new Date().toISOString(),
  }
  if (!mudouStatus) delete (linha as Record<string, unknown>).status_anterior

  const { error } = await supabaseAdmin
    .from('antecipacoes')
    .upsert(linha, { onConflict: 'id_externo' })
  if (error) {
    logger.error({ id: a.id_externo, erro: error.message }, 'Falha no upsert da antecipação.')
    acc.ignoradas++
    return
  }

  if (!anterior) {
    acc.novas++
    acc.eventos += await eventoSincronizada(a)
  } else {
    acc.atualizadas++
  }

  if (mudouStatus) {
    acc.status_alterados++
    acc.eventos += await eventoStatusAlterado(a, anterior.status)
  }

  // ── §4.5 Regressão ──
  // Antes do casamento, e não depois: uma antecipação que já converteu e voltou
  // atrás não deve ser recasada como se fosse nova.
  if (anterior?.convertida_em && anterior.access_key_casada) {
    const regrediu =
      !statusConverte(a.status, cfg) ||
      (a.invoice_cancelled_at !== null && anterior.invoice_cancelled_at === null)
    if (regrediu) {
      acc.regressoes++
      acc.eventos += await registrarRegressao(a, anterior, cfg)
      return
    }
  }

  // Já casada e sem regressão: nada a refazer. O casamento é caro (lê todas as
  // notas do par) e não muda de ideia sozinho.
  if (anterior?.match_status === 'casada' || anterior?.match_status === 'ignorada') {
    // A exceção: casou antes de o status virar conversor. Agora virou.
    if (
      anterior.match_status === 'casada' &&
      anterior.access_key_casada &&
      !anterior.convertida_em &&
      statusConverte(a.status, cfg)
    ) {
      acc.convertidas += await converterNota(a, anterior.access_key_casada, cfg)
      acc.eventos++
    }
    return
  }

  const resultado = await casar(a, cfg)
  acc[resultado.status === 'casada' ? 'casadas' : resultado.status === 'sem_nf' ? 'sem_nf' : 'revisao']++
  if (resultado.status === 'casada' && resultado.access_key) {
    if (statusConverte(a.status, cfg)) {
      acc.convertidas += await converterNota(a, resultado.access_key, cfg)
      acc.eventos++
    } else {
      // Casou, mas o status não converte (REPROVED, DRAFT…). Este é o ÚNICO
      // caminho que emite `antecipacao.casada`: quando a conversão acontece, o
      // `nf.convertida` já conta a mesma história com mais detalhe, e dois
      // eventos por fato transformam a timeline do fornecedor em eco.
      acc.eventos += await eventoCasada(a, resultado.access_key)
    }
  }
}

// ─── O casamento ────────────────────────────────────────────────────────────

/**
 * As candidatas do par fornecedor↔sacado.
 *
 * O recorte é sempre este e não é negociável: a média é 2,6 notas por par e a
 * pior 407, então trazer o par inteiro é barato — e é o que garante que o motor
 * NUNCA veja uma nota de outro fornecedor.
 */
async function candidatas(a: AntecipacaoNormalizada): Promise<CandidataNf[]> {
  const { data, error } = await supabaseAdmin
    .from('notas_fiscais')
    .select('access_key, numero, valor, vencimento')
    .eq('fornecedor_cnpj', a.fornecedor_cnpj)
    .eq('sacado_cnpj', a.sacado_cnpj)
    .limit(500)
  if (error) {
    logger.error({ id: a.id_externo, erro: error.message }, 'Falha ao buscar candidatas.')
    return []
  }
  return (data ?? []) as CandidataNf[]
}

async function casar(a: AntecipacaoNormalizada, cfg: ConfigConversao): Promise<ResultadoMatch> {
  const resultado = casarAntecipacao(
    {
      document_number: a.document_number,
      gross_value: a.gross_value,
      original_due_date: a.original_due_date,
    },
    await candidatas(a),
    { valor_pct: cfg.tolerancia_valor_pct, vencimento_dias: cfg.tolerancia_vencimento_dias },
  )

  await supabaseAdmin
    .from('antecipacoes')
    .update({
      match_status: resultado.status,
      access_key_casada: resultado.access_key,
      match_confianca: resultado.confianca,
      match_motivo: resultado.motivo,
      match_candidatas: resultado.candidatas as never,
      match_em: new Date().toISOString(),
      atualizada_em: new Date().toISOString(),
    })
    .eq('id_externo', a.id_externo)

  return resultado
}

// ─── §4.4 Os efeitos da conversão ───────────────────────────────────────────

/**
 * A nota vira `convertida`, o evento carrega os valores REAIS da operação e o
 * fornecedor passa a ser recorrência.
 *
 * `faixa_motivo` é preservado de propósito (§4.4): ele diz por que a nota entrou
 * na faixa em que entrou, e é o insumo da métrica que compara faixas por
 * conversão. Sobrescrevê-lo aqui apagaria a resposta justamente na hora em que a
 * pergunta finalmente tem resultado.
 */
async function converterNota(
  a: AntecipacaoNormalizada,
  accessKey: string,
  cfg: ConfigConversao,
): Promise<number> {
  void cfg

  const { data: nf } = await supabaseAdmin
    .from('notas_fiscais')
    .select('access_key, numero, valor, faixa, estagio_funil, fornecedor_empresa_id, fornecedor_nome')
    .eq('access_key', accessKey)
    .maybeSingle()
  if (!nf) return 0

  const { error } = await supabaseAdmin
    .from('notas_fiscais')
    .update({
      estagio_funil: 'convertida',
      estagio_alterado_em: new Date().toISOString(),
      // Ator = sistema. `estagio_alterado_por` fica nulo e o motivo vive no
      // evento, referenciando o id_externo — é o que torna "quem converteu esta
      // nota?" respondível meses depois.
      estagio_alterado_por: null,
      conversao_antecipacao_id: a.id_externo,
      conversao_em_disputa: false,
    })
    .eq('access_key', accessKey)
  if (error) {
    logger.error({ accessKey, erro: error.message }, 'Falha ao converter a nota.')
    return 0
  }

  await supabaseAdmin
    .from('antecipacoes')
    .update({ convertida_em: new Date().toISOString(), atualizada_em: new Date().toISOString() })
    .eq('id_externo', a.id_externo)

  await emitirEvento(nf.fornecedor_empresa_id, EVENTO_TIPOS.NF_CONVERTIDA, {
    titulo: `Nota ${nf.numero ?? accessKey} convertida`,
    resumo:
      `${nf.fornecedor_nome ?? a.fornecedor_nome ?? a.fornecedor_cnpj}: antecipação #${a.id_externo} ` +
      `(${a.anticipation_type ?? a.status}) de ${formatarMoeda(a.gross_value ?? 0)}` +
      `${a.monthly_interest_rate ? ` a ${a.monthly_interest_rate}% a.m.` : ''}.`,
    url: `/antecipacao?nota=${accessKey}`,
    access_key: accessKey,
    antecipacao_id: a.id_externo,
    origem: 'automatica',
    // Os valores REAIS. É o que faz as métricas por faixa do Prompt 04 pararem
    // de contar receita esperada e passarem a contar receita acontecida.
    gross_value: a.gross_value,
    net_value: a.net_value,
    total_spread: a.total_spread,
    taxa: a.monthly_interest_rate,
    prazo_dias: a.anticipation_days,
    faixa: nf.faixa,
    valor: nf.valor,
  })

  await atualizarFornecedor(nf.fornecedor_empresa_id, a)
  return 1
}

/** §4.4: o fornecedor antecipou de fato — vira (ou permanece) recorrência. */
async function atualizarFornecedor(
  empresaId: string | null,
  a: AntecipacaoNormalizada,
): Promise<void> {
  if (!empresaId) return
  const dia = (a.created_at_plataforma ?? new Date().toISOString()).slice(0, 10)

  const { data: empresa } = await supabaseAdmin
    .from('empresas')
    .select('ultima_antecipacao, tipagem_antecipacao')
    .eq('id', empresaId)
    .maybeSingle()
  if (!empresa) return

  const ultima =
    empresa.ultima_antecipacao && empresa.ultima_antecipacao > dia ? empresa.ultima_antecipacao : dia
  if (ultima === empresa.ultima_antecipacao && empresa.tipagem_antecipacao === 'recorrencia') return

  await supabaseAdmin
    .from('empresas')
    .update({ ultima_antecipacao: ultima, tipagem_antecipacao: 'recorrencia' })
    .eq('id', empresaId)

  if (empresa.tipagem_antecipacao && empresa.tipagem_antecipacao !== 'recorrencia') {
    await emitirEvento(empresaId, EVENTO_TIPOS.FORNECEDOR_TIPAGEM_ALTERADA, {
      resumo: `${a.fornecedor_nome ?? a.fornecedor_cnpj}: tipagem ${empresa.tipagem_antecipacao} → recorrencia (antecipou).`,
      de: empresa.tipagem_antecipacao,
      para: 'recorrencia',
    })
  }
}

// ─── §4.5 Regressão ─────────────────────────────────────────────────────────

async function registrarRegressao(
  a: AntecipacaoNormalizada,
  anterior: LinhaAnterior,
  cfg: ConfigConversao,
): Promise<number> {
  const cancelada = a.invoice_cancelled_at !== null && anterior.invoice_cancelled_at === null
  const accessKey = anterior.access_key_casada as string

  await supabaseAdmin
    .from('antecipacoes')
    .update({ regrediu_em: new Date().toISOString(), atualizada_em: new Date().toISOString() })
    .eq('id_externo', a.id_externo)

  // O estágio NÃO é revertido. A flag é o que torna isso honesto na tela: a nota
  // segue convertida e o card diz que a conversão está em disputa.
  await supabaseAdmin
    .from('notas_fiscais')
    .update({ conversao_em_disputa: true })
    .eq('access_key', accessKey)

  const { data: nf } = await supabaseAdmin
    .from('notas_fiscais')
    .select('numero, valor, fornecedor_empresa_id, fornecedor_nome')
    .eq('access_key', accessKey)
    .maybeSingle()

  const resumo =
    `${nf?.fornecedor_nome ?? a.fornecedor_nome ?? a.fornecedor_cnpj}: antecipação #${a.id_externo} ` +
    (cancelada
      ? 'teve a NF cancelada na plataforma'
      : `mudou de ${anterior.status} para ${a.status}, que não converte`) +
    `. A nota ${nf?.numero ?? accessKey} continua marcada como convertida — decida o estágio correto.`

  await emitirEvento(nf?.fornecedor_empresa_id ?? null, EVENTO_TIPOS.ANTECIPACAO_REGREDIU, {
    titulo: 'Conversão em disputa',
    resumo,
    url: `/antecipacao/antecipacoes?id=${a.id_externo}`,
    antecipacao_id: a.id_externo,
    access_key: accessKey,
    de: anterior.status,
    para: a.status,
    invoice_cancelled_at: a.invoice_cancelled_at,
    gross_value: a.gross_value,
  })

  // Push além do sino: uma conversão que talvez não exista é o tipo de coisa que
  // não pode depender de alguém estar olhando a timeline.
  await notificarPerfis(['Admin', 'Comercial'], {
    titulo: 'Conversão em disputa',
    corpo: resumo,
    url: `/antecipacao/antecipacoes?id=${a.id_externo}`,
  })

  void cfg
  return 1
}

// ─── Eventos de visibilidade ────────────────────────────────────────────────

async function empresaDoFornecedor(cnpj: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('empresas').select('id').eq('cnpj', cnpj).maybeSingle()
  return data?.id ?? null
}

async function eventoSincronizada(a: AntecipacaoNormalizada): Promise<number> {
  const empresaId = await empresaDoFornecedor(a.fornecedor_cnpj)
  if (!empresaId) return 0
  await emitirEvento(empresaId, EVENTO_TIPOS.ANTECIPACAO_SINCRONIZADA, {
    titulo: `Antecipação #${a.id_externo}`,
    resumo:
      `${a.fornecedor_nome ?? a.fornecedor_cnpj} → ${a.sacado_nome ?? a.sacado_cnpj}: ` +
      `${formatarMoeda(a.gross_value ?? 0)} (${a.status}).`,
    url: `/antecipacao/antecipacoes?id=${a.id_externo}`,
    antecipacao_id: a.id_externo,
  })
  return 1
}

async function eventoCasada(a: AntecipacaoNormalizada, accessKey: string): Promise<number> {
  const empresaId = await empresaDoFornecedor(a.fornecedor_cnpj)
  if (!empresaId) return 0
  await emitirEvento(empresaId, EVENTO_TIPOS.ANTECIPACAO_CASADA, {
    titulo: `Antecipação #${a.id_externo} casada com uma nota`,
    resumo:
      `${a.fornecedor_nome ?? a.fornecedor_cnpj}: documento ${a.document_number ?? '—'} ` +
      `(${formatarMoeda(a.gross_value ?? 0)}). A nota NÃO foi convertida — o status ` +
      `${a.status} não representa dinheiro operado.`,
    url: `/antecipacao/antecipacoes?id=${a.id_externo}`,
    antecipacao_id: a.id_externo,
    access_key: accessKey,
    status: a.status,
  })
  return 1
}

async function eventoStatusAlterado(a: AntecipacaoNormalizada, de: string): Promise<number> {
  const empresaId = await empresaDoFornecedor(a.fornecedor_cnpj)
  if (!empresaId) return 0
  await emitirEvento(empresaId, EVENTO_TIPOS.ANTECIPACAO_STATUS_ALTERADO, {
    titulo: `Antecipação #${a.id_externo}: ${de} → ${a.status}`,
    resumo: `${a.fornecedor_nome ?? a.fornecedor_cnpj}: ${formatarMoeda(a.gross_value ?? 0)}.`,
    url: `/antecipacao/antecipacoes?id=${a.id_externo}`,
    antecipacao_id: a.id_externo,
    de,
    para: a.status,
  })
  return 1
}

// ─── §4.2.4 Re-tentativa das pendentes ──────────────────────────────────────

/**
 * A NF pode simplesmente não ter chegado ainda: o sync de NFs olha 4 horas para
 * trás e o de antecipações 3 dias, então uma antecipação pode nascer órfã e
 * ganhar a nota no ciclo seguinte.
 *
 * Roda a cada ciclo sobre as pendentes DENTRO da janela. Passada a janela, o
 * `sem_nf` vira definitivo com evento — re-tentar para sempre transformaria este
 * job numa varredura da base inteira, seis vezes por dia, para não encontrar
 * nada.
 */
export async function rematchPendentes(): Promise<ResultadoRematch> {
  const cfg = await lerConfigConversao()
  const agora = Date.now()
  const limiteJanela = new Date(
    agora - (cfg.janela_sync_dias + cfg.janela_rematch_dias) * 86_400_000,
  ).toISOString()

  const acc: ResultadoRematch = {
    tentadas: 0,
    casadas: 0,
    convertidas: 0,
    ainda_sem_nf: 0,
    definitivas: 0,
    eventos: 0,
  }

  // Duas consultas, e não uma com `in(...)`, por causa da JANELA:
  //
  //   `pendente` é um estado de MEIO DE PASSAGEM — existe entre o upsert e o
  //   casamento da mesma iteração. Uma linha que ficou assim é resíduo de um
  //   processo que morreu no meio, e não pode ser cortada pela janela nem por um
  //   `created_at_plataforma` nulo: ninguém mais vai olhar para ela.
  //
  //   `sem_nf` é um estado LEGÍTIMO com prazo. Esse sim respeita a janela.
  const { data: presos, error: erroPresos } = await supabaseAdmin
    .from('antecipacoes')
    .select('*')
    .eq('match_status', 'pendente')
    .limit(2_000)

  const { data: semNf, error } = await supabaseAdmin
    .from('antecipacoes')
    .select('*')
    .eq('match_status', 'sem_nf')
    .is('sem_nf_definitivo_em', null)
    .gte('created_at_plataforma', limiteJanela)
    .order('created_at_plataforma', { ascending: false })
    .limit(2_000)

  if (error ?? erroPresos) {
    logger.error(
      { erro: (error ?? erroPresos)?.message },
      'Falha ao listar antecipações pendentes.',
    )
    return acc
  }

  for (const linha of [...(presos ?? []), ...(semNf ?? [])]) {
    acc.tentadas++
    const a = deLinha(linha)
    const r = await casar(a, cfg)
    if (r.status === 'casada' && r.access_key) {
      acc.casadas++
      if (statusConverte(a.status, cfg)) {
        acc.convertidas += await converterNota(a, r.access_key, cfg)
        acc.eventos++
      }
    } else if (r.status === 'sem_nf') {
      acc.ainda_sem_nf++
    }
  }

  // Fora da janela e ainda sem nota: o `sem_nf` deixa de ser "ainda não chegou"
  // e passa a ser um fato com evento — alguém precisa olhar, ou a antecipação
  // existe contra uma nota que nunca vamos ver.
  const { data: vencidas } = await supabaseAdmin
    .from('antecipacoes')
    .select('*')
    .eq('match_status', 'sem_nf')
    .is('sem_nf_definitivo_em', null)
    .lt('created_at_plataforma', limiteJanela)
    .limit(500)

  for (const linha of vencidas ?? []) {
    const a = deLinha(linha)
    await supabaseAdmin
      .from('antecipacoes')
      .update({ sem_nf_definitivo_em: new Date().toISOString() })
      .eq('id_externo', a.id_externo)
    acc.definitivas++

    const empresaId = await empresaDoFornecedor(a.fornecedor_cnpj)
    if (empresaId) {
      await emitirEvento(empresaId, EVENTO_TIPOS.ANTECIPACAO_SEM_NF, {
        titulo: `Antecipação #${a.id_externo} sem nota correspondente`,
        resumo:
          `${a.fornecedor_nome ?? a.fornecedor_cnpj} → ${a.sacado_nome ?? a.sacado_cnpj}: ` +
          `documento ${a.document_number ?? '—'}, ${formatarMoeda(a.gross_value ?? 0)}. ` +
          `Passaram ${cfg.janela_rematch_dias} dias sem a NF aparecer no sync.`,
        url: `/antecipacao/antecipacoes?id=${a.id_externo}`,
        antecipacao_id: a.id_externo,
        document_number: a.document_number,
      })
      acc.eventos++
    }
  }

  logger.info(acc, 'Re-matching de antecipações pendentes concluído.')
  return acc
}

/** A linha do banco de volta ao formato que o motor e os efeitos consomem. */
function deLinha(linha: Record<string, unknown>): AntecipacaoNormalizada {
  const l = linha as {
    id_externo: number
    status: string
    anticipation_type: string | null
    document_number: string | null
    numero_normalizado: string | null
    sacado_cnpj: string
    fornecedor_cnpj: string
    sacado_nome: string | null
    fornecedor_nome: string | null
    request_date: string | null
    created_at_plataforma: string | null
    original_due_date: string | null
    completion_date: string | null
    anticipation_days: number | null
    gross_value: number | null
    withhold_tax: number | null
    discounted_amount: number | null
    net_value: number | null
    total_spread: number | null
    monthly_interest_rate: number | null
    approval_with_automation: boolean | null
    invoice_cancelled_at: string | null
  }
  return { ...l }
}

/** O rótulo pt-BR do motivo, para o log e para a fila. */
export function labelMotivoMatch(motivo: string | null | undefined): string {
  if (!motivo) return '—'
  return MOTIVO_MATCH_LABELS[motivo as keyof typeof MOTIVO_MATCH_LABELS] ?? motivo
}
