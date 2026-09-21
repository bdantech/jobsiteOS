import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { normalizeCnpj } from '../../../../../packages/core/src/schemas/cnpj.js'
import {
  calcularReceitaEsperada,
  calcularTipagem,
  diasParaVencimento,
  formatarMoeda,
} from '../../../../../packages/core/src/antecipacao/economia.js'
import {
  MOTIVOS_DESCARTE,
  extrairNotas,
  normalizarNfPayload,
  totalDePaginas,
  type MotivoDescarte,
  type CreditAnalysisPayload,
  type NfPayload,
  type NotaNormalizada,
  type ParticipantePayload,
  type RespostaNf,
} from '../../../../../packages/core/src/antecipacao/nf-payload.js'
import type { TablesInsert } from '../../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'
import { emitirEvento } from '../../radar/eventos.js'
import {
  fatiarJanela,
  montarPlanoSync,
  querystringSync,
  type ModoSync,
  type RequisicaoSync,
} from '../../../../../packages/core/src/antecipacao/sync-plano.js'
import { lerConfigEconomia, lerConfigSync } from '../../antecipacao/config.js'
import type { ConfigEconomia } from '../../../../../packages/core/src/antecipacao/schemas.js'
import { calcularTac } from '../../../../../packages/core/src/credito/precificacao.js'
import { materializarContato, somarContatos } from './contatos-nf.js'

/**
 * Sync de notas fiscais (§3), de 4 em 4 horas.
 *
 * Três garantias, e todas as decisões abaixo saem delas:
 *
 * 1. IDEMPOTÊNCIA POR access_key. É o que torna a janela com sobreposição segura:
 *    buscamos desde o último sync bem-sucedido MENOS um colchão de horas, porque
 *    o lado de lá atrasa. Nota nova insere, repetida atualiza — e um cancelamento
 *    ou uma mudança de creditAnalysis chegam como UPDATE da mesma linha, que é
 *    exatamente o que queremos que aconteça.
 *
 * 2. O XML É GUARDADO SEMPRE. É a semente do Pricing. Uma falha de parse LOGA e
 *    SEGUE: valor e vencimento também vêm do endpoint, e uma nota com XML
 *    estranho continua entrando no funil. O erro fica em `xml_parse_erro` e o XML
 *    fica em `raw_xml` para reprocessar.
 *
 * 3. UM SNAPSHOT DE CRÉDITO SÓ QUANDO ALGO MUDOU. O valor está na derivada (o
 *    limite caiu, o status virou), não em 40 mil linhas idênticas por dia.
 */

// ─── O payload ──────────────────────────────────────────────────────────────
// As interfaces e a normalização vivem em packages/core/src/antecipacao/
// nf-payload.ts, junto do teste que usa o payload REAL como fixture. É o mesmo
// motivo do plano de sincronização: contrato de terceiro precisa de teste.

export interface ResultadoSyncNfs {
  modo: string
  plano: string
  requisicoes: number
  paginas: number
  notas: number
  novas: number
  atualizadas: number
  itens: number
  snapshots_credito: number
  cnpjs_enfileirados: number
  contatos_criados: number
  contatos_completados: number
  eventos: number
  ignoradas: number
  /**
   * POR QUE cada nota foi ignorada. `ignoradas` sozinha é um número que não
   * responde nada: ela saltou de 0,4% para 94% em 14/09/2026 e ficou nove dias
   * assim, com 9.463 notas descartadas, sem um alerta — porque o motivo só
   * existia num `logger.warn` que ninguém lê. Agora ele entra no `meta` da
   * ingestão, que é o que a tela de Ingestões mostra.
   */
  descartes: Record<MotivoDescarte | 'erro_upsert', number>
  falhas_parse: number
  /** Notas que chegaram em resumo (resNFe) e vão precisar de releitura. */
  resumos: number
  /** Notas que estavam válidas aqui e vieram canceladas/denegadas agora. */
  canceladas: number
  /** Só no modo insert-only: nota que já existe e foi deixada como está. */
  preservadas: number
  /** Resumos que ganharam o XML completo nesta corrida. */
  promovidas: number
}

/**
 * O que muda entre as três formas de chamar o sync.
 *
 * `requisicoes` substitui o plano inteiro: o backfill e a promoção de resumos
 * sabem exatamente qual janela querem, e passar por `montarPlanoSync` só faria
 * essa janela ser recalculada a partir do último sync — que é outra pergunta.
 *
 * `apenasNovas` é INSERT-ONLY, e existe porque recuperar o que faltou e reescrever
 * o que já está gravado são decisões diferentes. Uma nota que alguém já trabalhou
 * aqui (estágio movido, vendedor atribuído, nota recuperada à mão) não pode ser
 * atropelada por uma releitura de três meses atrás.
 */
export interface OpcoesSync {
  requisicoes?: RequisicaoSync[]
  descricao?: string
  apenasNovas?: boolean
}

// ─── O plano de requisições ─────────────────────────────────────────────────
// A lógica (e o CONTRATO do endpoint) vive em packages/core/src/antecipacao/
// sync-plano.ts, que é onde há teste. Aqui fica só a leitura do último sync —
// a única parte que precisa do banco.

async function ultimoSyncConcluido(): Promise<Date | null> {
  const { data } = await supabaseAdmin
    .from('mercado_ingestoes')
    .select('terminado_em')
    .eq('fonte', 'onepay_nf')
    .eq('status', 'concluida')
    .order('terminado_em', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  return data?.terminado_em ? new Date(data.terminado_em) : null
}

function autorizacao(): Record<string, string> {
  const token = env.ONEPAY_NF_TOKEN ?? env.ONEPAY_BI_TOKEN
  return token ? { authorization: `Bearer ${token}` } : {}
}

/**
 * O caminho do recurso de NFs, CONFIRMADO contra a API
 * (`{ONEPAY_BI_URL}/api/v1/invoices`) — o Prompt só dizia `/api/v1/...`.
 *
 * Continua sendo um default e não uma constante fixa: se o recurso mudar de
 * caminho ou de host, a correção é `ONEPAY_NF_URL` com a URL completa, sem deploy.
 */
const CAMINHO_NF_PADRAO = '/api/v1/invoices'

/**
 * A URL do recurso, resolvida a partir do que existir:
 *
 *   ONEPAY_NF_URL completa (…/api/v1/algo)  → usada como está
 *   ONEPAY_NF_URL só o host                 → host + caminho padrão
 *   ausente                                 → ONEPAY_BI_URL + caminho padrão
 *
 * O fallback para `ONEPAY_BI_URL` existe porque é a MESMA API e o MESMO token do
 * sync de clientes Onepay — pedir duas variáveis com o mesmo valor só cria a
 * chance de elas divergirem no dia em que o host mudar.
 */
function urlBase(): string {
  const bruta = (env.ONEPAY_NF_URL ?? env.ONEPAY_BI_URL ?? '').replace(/\/+$/, '')
  return /\/api\//.test(bruta) ? bruta : `${bruta}${CAMINHO_NF_PADRAO}`
}

function numeroOuNulo(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function textoOuNulo(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** 14 dígitos ou null: a coluna tem check e um valor torto derrubaria o insert. */
function cnpjOuNulo(v: unknown): string | null {
  const c = normalizeCnpj(String(v ?? ''))
  return c.length === 14 ? c : null
}

function dataOuNulo(v: unknown): string | null {
  const s = textoOuNulo(v)
  if (!s) return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  return m?.[1] ?? null
}

// ─── O job ──────────────────────────────────────────────────────────────────

export async function sincronizarNotasFiscais(
  modo: ModoSync = 'incremental',
  opcoes: OpcoesSync = {},
): Promise<ResultadoSyncNfs> {
  if (!env.ONEPAY_NF_URL && !env.ONEPAY_BI_URL) {
    throw new Error(
      'Nenhuma URL do Onepay configurada. Defina ONEPAY_BI_URL (a mesma do sync de clientes) ou, ' +
        'se o recurso de NFs estiver em outro caminho, ONEPAY_NF_URL com a URL completa.',
    )
  }

  const [cfgSync, cfgEconomia, ultimoSync] = await Promise.all([
    lerConfigSync(),
    lerConfigEconomia(),
    ultimoSyncConcluido(),
  ])
  const plano = opcoes.requisicoes
    ? {
        modo: 'recuperacao' as const,
        requisicoes: opcoes.requisicoes,
        descricao: opcoes.descricao ?? `janela explícita (${opcoes.requisicoes.length} bloco(s))`,
      }
    : montarPlanoSync({ modo, ultimoSync, agora: new Date(), cfg: cfgSync })
  const base = urlBase()

  const acc: ResultadoSyncNfs = {
    modo: plano.modo,
    plano: plano.descricao,
    requisicoes: plano.requisicoes.length,
    paginas: 0,
    notas: 0,
    novas: 0,
    atualizadas: 0,
    itens: 0,
    snapshots_credito: 0,
    cnpjs_enfileirados: 0,
    contatos_criados: 0,
    contatos_completados: 0,
    eventos: 0,
    ignoradas: 0,
    descartes: descartesZerados(),
    falhas_parse: 0,
    resumos: 0,
    canceladas: 0,
    preservadas: 0,
    promovidas: 0,
  }

  logger.info({ plano: plano.descricao, requisicoes: plano.requisicoes.length, base }, 'Sync de NFs iniciado.')

  for (const req of plano.requisicoes) {
    let page = 1

    // Pagina até a página vir CURTA. `total_pages` é usado quando existe, mas não
    // é exigido: um endpoint que só devolve a lista continua sendo paginado
    // corretamente, e um que devolve `total_pages` errado não trava o job.
    for (;;) {
      const url = `${base}?${querystringSync(req, page, cfgSync.page_size)}`
      const resp = await requisitarJson<RespostaNf>(url, {
        headers: autorizacao(),
        timeoutMs: 120_000,
      })

      const itens = extrairNotas(resp)
      acc.paginas++

      for (const item of itens) {
        const r = await processarNota(item, cfgEconomia, opcoes.apenasNovas === true)
        acc.notas++
        if (r.preservada) acc.preservadas++
        if (r.promovida) acc.promovidas++
        if (r.ignorada) acc.ignoradas++
        if (r.motivo) acc.descartes[r.motivo]++
        if (r.resumo) acc.resumos++
        if (r.cancelada) acc.canceladas++
        if (r.nova) acc.novas++
        if (r.atualizada) acc.atualizadas++
        acc.itens += r.itens
        acc.snapshots_credito += r.snapshot ? 1 : 0
        acc.cnpjs_enfileirados += r.enfileirados
        acc.contatos_criados += r.contatos_criados
        acc.contatos_completados += r.contatos_completados
        acc.eventos += r.eventos
        if (r.falhaParse) acc.falhas_parse++
      }

      const totalPaginas = totalDePaginas(resp)
      const acabou =
        itens.length === 0 ||
        itens.length < cfgSync.page_size ||
        (typeof totalPaginas === 'number' && page >= totalPaginas)
      if (acabou) break

      page++
    }
  }

  logger.info(acc, 'Sync de NFs concluído.')
  return acc
}

function descartesZerados(): ResultadoSyncNfs['descartes'] {
  const zero = { erro_upsert: 0 } as ResultadoSyncNfs['descartes']
  for (const m of MOTIVOS_DESCARTE) zero[m] = 0
  return zero
}

interface ResultadoNota {
  ignorada: boolean
  /** Preenchido só quando `ignorada`: é o que explica a corrida estranha. */
  motivo: MotivoDescarte | 'erro_upsert' | null
  resumo: boolean
  cancelada: boolean
  preservada: boolean
  promovida: boolean
  nova: boolean
  atualizada: boolean
  itens: number
  snapshot: boolean
  enfileirados: number
  contatos_criados: number
  contatos_completados: number
  eventos: number
  falhaParse: boolean
}

const NADA: ResultadoNota = {
  ignorada: true,
  motivo: null,
  resumo: false,
  cancelada: false,
  preservada: false,
  promovida: false,
  nova: false,
  atualizada: false,
  itens: 0,
  snapshot: false,
  enfileirados: 0,
  contatos_criados: 0,
  contatos_completados: 0,
  eventos: 0,
  falhaParse: false,
}

async function processarNota(
  item: NfPayload,
  cfg: ConfigEconomia,
  apenasNovas = false,
): Promise<ResultadoNota> {
  // Toda a leitura do payload (e do XML) acontece no core, testada contra o
  // payload real. Aqui só sobra o que precisa do banco.
  const r = normalizarNfPayload(item, undefined, cfg.valor_minimo_operavel)
  if (!r.ok) {
    logger.warn({ id: r.id, motivo: r.motivo, tipo: item.type }, 'NF descartada no sync.')
    return { ...NADA, motivo: r.motivo }
  }
  const nota: NotaNormalizada = r.nota
  const { access_key: accessKey, fornecedor_cnpj: fornecedorCnpj, sacado_cnpj: sacadoCnpj } = nota

  /*
   * O que já está gravado é lido ANTES da precificação, e não depois: no modo
   * insert-only a resposta é "pula", e calcular taxa, TAC e cadastro das duas
   * pontas para depois jogar fora custaria quatro consultas por nota num backfill
   * que roda sobre dezenas de milhares delas.
   */
  const gravada = await notaGravada(accessKey)
  if (apenasNovas && gravada.existe) {
    return { ...NADA, ignorada: false, preservada: true }
  }

  const dias = diasParaVencimento(nota.vencimento)

  // `monthlyRateD0` é a taxa que precifica a nota; sem ela, o último snapshot do
  // sacado; sem nenhum, o default da config.
  const { receita, taxa } = calcularReceitaEsperada({
    valor: nota.valor,
    diasParaVencimento: dias,
    taxaMensal: nota.credito?.monthlyRateD0 ?? (await taxaDoUltimoSnapshot(sacadoCnpj)),
    taxaPadrao: cfg.taxa_mensal_padrao,
  })

  // A TAC e o seguro entram no líquido desde a 0221. São PREÇO, não tempo: não
  // andam com o prazo como o deságio anda, e por isso são gravados uma vez.
  const tac = calcularTac(nota.valor ?? 0, ...(await tacDoSacado(sacadoCnpj, cfg)))

  // A taxa da ANÁLISE, separada de `taxa_usada` (0225): esta é a que a Ana diz em
  // voz alta, e ela é nula quando não existe análise — nem do sacado, nem da
  // empresa-mãe. `taxa_usada` continua caindo no default, porque ordenar o funil
  // com um chute bom é melhor que não ordenar.
  const analise = await taxaDaAnalise(sacadoCnpj)

  const [fornecedor, sacado] = await Promise.all([
    resolverEmpresa(fornecedorCnpj, item.supplier ?? null),
    resolverEmpresa(sacadoCnpj, item.recipient ?? null),
  ])

  const jaExistia = gravada.existe
  // Passou a cancelada/denegada AGORA. Só conta como transição quem estava válida
  // aqui: a nota que já chegou cancelada é cadastro, não notícia.
  const virouCancelada = jaExistia && gravada.situacao === 'valida' && nota.situacao !== 'valida'

  if (nota.avisos.length > 0) {
    logger.warn({ accessKey, avisos: nota.avisos }, 'Valor de enum desconhecido no payload de NF.')
  }

  const linha: TablesInsert<'notas_fiscais'> = {
    access_key: accessKey,
    nf_id_externo: nota.nf_id_externo,
    tipo: nota.tipo,
    direction: nota.direction,
    numero: nota.numero,
    serie: nota.serie,
    valor: nota.valor,
    emitida_em: nota.emitida_em,
    vencimento: nota.vencimento,
    vencimento_origem: nota.vencimento_origem,
    natureza_operacao: nota.natureza_operacao,
    // `operavel_manual` NÃO é tocado aqui de propósito: se um operador recuperou uma
    // nota que a regra ocultou, o sync seguinte não pode desfazer isso.
    operavel: nota.operavel,
    nao_operavel_motivo: nota.nao_operavel_motivo,
    parcelas: nota.parcelas.length > 0 ? (nota.parcelas as never) : null,
    status_sync: nota.status_sync,
    sacado_cnpj: sacadoCnpj,
    sacado_nome: nota.sacado_nome,
    sacado_cadastrado: nota.sacado_cadastrado,
    sacado_empresa_id: sacado.empresaId,
    contato_sacado: nota.contato_sacado as never,
    fornecedor_cnpj: fornecedorCnpj,
    fornecedor_nome: nota.fornecedor_nome,
    fornecedor_cadastrado: nota.fornecedor_cadastrado,
    fornecedor_empresa_id: fornecedor.empresaId,
    contato_fornecedor: nota.contato_fornecedor as never,
    receita_esperada: receita,
    taxa_usada: taxa,
    tac_estimada: tac,
    seguro_estimado: cfg.seguro_por_nota,
    dias_para_vencimento: dias,
    credit_status: nota.credito?.status ?? null,
    credit_role: nota.credito?.role ?? null,
    credit_limite: nota.credito?.creditLimit ?? null,
    credit_disponivel: nota.credito?.availableLimit ?? null,
    raw_xml: nota.raw_xml,
    xml_parse_erro: nota.xml_parse_erro,
    sincronizada_em: nota.sincronizada_em,
  }

  /*
   * `taxa_analise_*` nasceu na 0225 e `database.ts` é GERADO do banco: o tipo do
   * insert só conhece a coluna depois que o `pnpm db:types` rodar. O cast fica
   * num lugar só e some nesse dia.
   */
  const comTaxaDaAnalise = {
    ...linha,
    taxa_analise_am: analise.taxa,
    taxa_analise_origem: analise.origem,
    situacao: nota.situacao,
    xml_resumo: nota.xml_resumo,
    // Só carimba na TRANSIÇÃO. Reescrever a cada sync faria toda nota cancelada
    // parecer cancelada hoje, e é justamente essa data que diz se alguém estava
    // trabalhando a nota quando ela caiu.
    ...(virouCancelada ? { cancelada_em: new Date().toISOString() } : {}),
  } as typeof linha

  const { error } = await supabaseAdmin
    .from('notas_fiscais')
    .upsert(comTaxaDaAnalise, { onConflict: 'access_key' })
  if (error) {
    logger.error({ accessKey, erro: error.message }, 'Falha no upsert da NF.')
    return { ...NADA, motivo: 'erro_upsert' }
  }

  let eventos = 0

  // `nf.sincronizada` apenas na PRIMEIRA vez (§7). O sync roda 6× por dia com
  // sobreposição; um evento por passagem encheria a timeline de ruído.
  if (!jaExistia && fornecedor.empresaId) {
    await emitirEvento(fornecedor.empresaId, EVENTO_TIPOS.NF_SINCRONIZADA, {
      titulo: 'Nova nota fiscal',
      resumo:
        `${nota.fornecedor_nome ?? fornecedorCnpj} → ${nota.sacado_nome ?? sacadoCnpj}: ` +
        `${formatarMoeda(nota.valor)}${dias !== null ? `, vence em ${dias} dias` : ''}.`,
      url: `/antecipacao?nota=${accessKey}`,
      access_key: accessKey,
      valor: nota.valor,
    })
    eventos++
  }

  /*
   * O cancelamento vira evento na timeline do FORNECEDOR, e não um número no
   * resumo do sync: quem precisa saber é quem estava trabalhando a nota. Uma nota
   * de R$ 78 mil que sai do funil em silêncio é um vendedor ligando na
   * segunda-feira para oferecer antecipação de um documento que não existe mais.
   */
  if (virouCancelada && fornecedor.empresaId) {
    await emitirEvento(fornecedor.empresaId, EVENTO_TIPOS.NF_CANCELADA, {
      titulo: nota.situacao === 'denegada' ? 'Nota denegada' : 'Nota cancelada',
      resumo:
        `${nota.fornecedor_nome ?? fornecedorCnpj} → ${nota.sacado_nome ?? sacadoCnpj}: ` +
        `${formatarMoeda(nota.valor)} — a nota ${nota.numero ?? ''} saiu do funil ` +
        `(status ${nota.status_sync ?? 'desconhecido'}).`,
      url: `/antecipacao?nota=${accessKey}`,
      access_key: accessKey,
      valor: nota.valor,
    })
    eventos++
  }

  const itens = await gravarItens(accessKey, nota.itens, jaExistia)
  const snapshot = await gravarSnapshotCredito(sacadoCnpj, nota.credito, sacado.empresaId)
  if (snapshot.evento) eventos++

  await atualizarTipagem(fornecedor.empresaId, fornecedorCnpj, nota.fornecedor_cadastrado ?? false)

  const enfileirados =
    (await enfileirarLookup(fornecedorCnpj, 'fornecedor_nf', fornecedor.conhecido)) +
    (await enfileirarLookup(sacadoCnpj, 'sacado_nf', sacado.conhecido))

  const contatos = somarContatos(
    await materializarContato(fornecedor.empresaId, nota.contato_fornecedor),
    await materializarContato(sacado.empresaId, nota.contato_sacado),
  )

  return {
    ignorada: false,
    motivo: null,
    resumo: nota.xml_resumo,
    cancelada: virouCancelada,
    preservada: false,
    promovida: gravada.resumo === true && !nota.xml_resumo,
    nova: !jaExistia,
    atualizada: jaExistia,
    itens,
    snapshot: snapshot.gravado,
    enfileirados,
    contatos_criados: contatos.criados,
    contatos_completados: contatos.completados,
    eventos,
    falhaParse: nota.xml_parse_erro !== null,
  }
}

/**
 * O que já está gravado desta nota — e não só SE está.
 *
 * A situação anterior é o que permite ver a TRANSIÇÃO: uma nota que estava válida
 * aqui e chega cancelada agora é um evento (alguém pode estar negociando com ela
 * neste minuto), enquanto uma que já estava cancelada é só o sync repetindo.
 * Comparar contra o que está no banco é a única forma de distinguir as duas.
 */
async function notaGravada(
  accessKey: string,
): Promise<{ existe: boolean; situacao: string | null; resumo: boolean }> {
  const { data } = await supabaseAdmin
    .from('notas_fiscais')
    .select('access_key, situacao, xml_resumo')
    .eq('access_key', accessKey)
    .maybeSingle()
  const linha = data as { situacao?: string | null; xml_resumo?: boolean | null } | null
  return {
    existe: linha !== null,
    situacao: linha?.situacao ?? null,
    resumo: linha?.xml_resumo === true,
  }
}

/** A taxa do snapshot mais recente do sacado, quando o payload não trouxe uma. */
async function taxaDoUltimoSnapshot(cnpj: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from('credito_snapshots')
    .select('monthly_rate_d0')
    .eq('cnpj', cnpj)
    .order('capturado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.monthly_rate_d0 ?? null
}

/**
 * A régua da TAC deste sacado: `[max, min, limiar, piso]`, na ordem de `calcularTac`.
 *
 * ── DO SACADO, COMO A TAXA ──────────────────────────────────────────────────
 * É o risco dele que precifica a nota, então é a tarifa DELE que diz quanto custa a
 * operação. Sem tarifa conhecida, a régua padrão da config — que nasce com os números
 * da matriz semente.
 *
 * ── A ANÁLISE DA PLATAFORMA VEM ANTES DA CONDIÇÃO PUBLICADA ─────────────────
 * A tentação é ler `condicoes_comerciais`: é a nossa tabela, é o que o Crédito
 * publicou. Mas publicada só existe para as empresas NOVAS que estamos mandando
 * agora — a base inteira, que já operava antes desta tela existir, não tem nenhuma.
 * A tarifa real dessas empresas chega pelo sync da análise de crédito
 * (`analises_plataforma.fee_d0` / `min_fee_d0`), e é ela que a plataforma vai
 * debitar de fato: 245 CNPJs contra 1. Estimar o líquido com a régua padrão quando
 * existe a tarifa verdadeira é errar por preguiça de procurar na tabela certa.
 *
 * A ordem também resolve o desempate: quando as duas existem, vale a da plataforma,
 * porque quem cobra é ela. Uma condição recém-publicada que ela ainda não ingeriu
 * fica atrás por uma janela de sync — e é melhor errar para o que SERÁ cobrado hoje
 * do que para o que passará a valer quando o outro lado processar.
 *
 * ── O LIMIAR E O PISO VÊM DA MATRIZ QUE PRECIFICOU AQUELA RÉGUA ─────────────
 * Para a condição publicada, a matriz é a `matriz_versao` que ela guarda, e não a de
 * hoje: a proporcionalidade faz parte da mesma tabela de preços que gerou o fee, e
 * misturar o fee de uma versão com o limiar de outra inventa um terceiro preço que
 * ninguém aprovou. Para a análise da plataforma, que não guarda versão, vale a matriz
 * ATIVA — é o que sabemos hoje sobre o formato da rampa.
 *
 * ── CACHE POR CNPJ ──────────────────────────────────────────────────────────
 * Um sync varre milhares de notas e um punhado de sacados se repete em quase
 * todas. Sem o cache seriam duas consultas por nota para ler um número que não
 * muda no meio da execução.
 */
type ReguaTac = [max: number, min: number, limiar: number, piso: number]

const cacheTac = new Map<string, ReguaTac>()
const cacheMatriz = new Map<number | 'ativa', [number, number]>()
const cacheTaxaAnalise = new Map<string, { taxa: number | null; origem: string | null }>()

/** `[limiar, piso]` da versão pedida; `'ativa'` lê a matriz em vigor. */
async function rampaDaMatriz(
  versao: number | 'ativa',
  cfg: ConfigEconomia,
): Promise<[number, number]> {
  const guardado = cacheMatriz.get(versao)
  if (guardado) return guardado

  const consulta = supabaseAdmin.from('precificacao_matriz').select('definicao')
  const { data } =
    versao === 'ativa'
      ? await consulta.eq('ativa', true).limit(1).maybeSingle()
      : await consulta.eq('versao', versao).maybeSingle()

  const def = data?.definicao as {
    faixas?: { limiar_proporcionalidade_tac?: number; piso_proporcionalidade_tac?: number }
  } | null

  const bruto = (valor: unknown, padrao: number): number => {
    const n = Number(valor ?? padrao)
    return Number.isFinite(n) && n > 0 ? n : padrao
  }
  const rampa: [number, number] = [
    bruto(def?.faixas?.limiar_proporcionalidade_tac, cfg.tac_limiar_padrao),
    bruto(def?.faixas?.piso_proporcionalidade_tac, cfg.tac_piso_padrao),
  ]

  cacheMatriz.set(versao, rampa)
  return rampa
}

/**
 * A taxa da análise de crédito deste sacado — e da empresa-mãe quando ele não tem
 * uma própria.
 *
 * SPE e filial não são analisadas: quem é analisada é a construtora dona delas, e
 * é a condição dela que a plataforma aplica. `app__taxa_da_analise` (0225) é a
 * mesma escada que o backfill percorreu, chamada aqui para que a nota que chega
 * amanhã nasça com o mesmo número que a de ontem.
 */
async function taxaDaAnalise(
  cnpj: string,
): Promise<{ taxa: number | null; origem: string | null }> {
  const guardado = cacheTaxaAnalise.get(cnpj)
  if (guardado) return guardado

  /*
   * `.bind` e não `supabaseAdmin.rpc` solto — e o cast é justamente o que escondia
   * isso. `rpc()` do supabase-js faz `return this.rest.rpc(...)`; arrancado do
   * objeto, `this` é undefined (módulo ES é strict) e a chamada estoura com
   * "Cannot read properties of undefined (reading 'rest')" na PRIMEIRA nota do
   * sync, antes do upsert — ou seja, a corrida inteira morre.
   *
   * O `as unknown as` some com o erro em typecheck porque promete uma função
   * livre, que é o que ela deixou de ser ao ser destacada. Continua necessário
   * (a função nasceu na 0225 e `database.ts` é gerado do banco), mas agora sobre
   * algo que já está amarrado ao receptor.
   */
  const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as (
    nome: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: { taxa: number | null; origem: string | null }[] | null
    error: { message: string } | null
  }>
  const { data, error } = await rpc('app__taxa_da_analise', { p_sacado_cnpj: cnpj })
  if (error) {
    logger.warn({ cnpj, erro: error.message }, 'Falha ao resolver a taxa da análise.')
    return { taxa: null, origem: null }
  }
  const linha = Array.isArray(data) ? data[0] : null
  const taxa = Number(linha?.taxa ?? Number.NaN)
  const resolvido = {
    taxa: Number.isFinite(taxa) ? taxa : null,
    origem: (linha?.origem as string | null) ?? null,
  }
  cacheTaxaAnalise.set(cnpj, resolvido)
  return resolvido
}

async function tacDoSacado(cnpj: string, cfg: ConfigEconomia): Promise<ReguaTac> {
  const guardado = cacheTac.get(cnpj)
  if (guardado) return guardado

  // D0, e não D1, porque é a `monthlyRateD0` que precifica o juros desta nota —
  // as duas parcelas têm de falar do mesmo produto.
  const daPlataforma = await supabaseAdmin
    .from('analises_plataforma')
    .select('fee_d0, min_fee_d0')
    .eq('cnpj', cnpj)
    .not('fee_d0', 'is', null)
    .order('sincronizada_em', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  let regua: ReguaTac | null = null

  const feeP = Number(daPlataforma.data?.fee_d0 ?? Number.NaN)
  const feeMinP = Number(daPlataforma.data?.min_fee_d0 ?? Number.NaN)
  if (Number.isFinite(feeP) && Number.isFinite(feeMinP)) {
    regua = [feeP, feeMinP, ...(await rampaDaMatriz('ativa', cfg))]
  }

  if (!regua) {
    const { data } = await supabaseAdmin
      .from('condicoes_comerciais')
      .select('fee_d0, fee_min_d0, matriz_versao')
      .eq('cnpj', cnpj)
      .eq('status', 'publicada')
      .order('publicada_em', { ascending: false })
      .limit(1)
      .maybeSingle()

    const fee = Number(data?.fee_d0 ?? Number.NaN)
    const feeMin = Number(data?.fee_min_d0 ?? Number.NaN)
    if (Number.isFinite(fee) && Number.isFinite(feeMin)) {
      regua = [fee, feeMin, ...(await rampaDaMatriz(Number(data?.matriz_versao ?? 0), cfg))]
    }
  }

  regua ??= [cfg.tac_max_padrao, cfg.tac_min_padrao, cfg.tac_limiar_padrao, cfg.tac_piso_padrao]

  cacheTac.set(cnpj, regua)
  return regua
}

// ─── Itens ──────────────────────────────────────────────────────────────────

/**
 * Reescreve os itens só quando há itens a escrever. Um XML que não parseou não
 * pode APAGAR os itens que uma passagem anterior extraiu com sucesso.
 */
async function gravarItens(
  accessKey: string,
  itens: NotaNormalizada['itens'],
  jaExistia: boolean,
): Promise<number> {
  if (itens.length === 0) return 0

  if (jaExistia) {
    await supabaseAdmin.from('nota_itens').delete().eq('access_key', accessKey)
  }

  const linhas = itens.map((i) => ({ access_key: accessKey, ...i }))
  const { error } = await supabaseAdmin.from('nota_itens').insert(linhas)
  if (error) {
    logger.error({ accessKey, erro: error.message }, 'Falha ao gravar itens da NF (segue).')
    return 0
  }
  return linhas.length
}

// ─── Crédito ────────────────────────────────────────────────────────────────

function creditoMudou(
  anterior: {
    status: string | null
    credit_limit: number | null
    available_limit: number | null
    monthly_rate_d0: number | null
  } | null,
  atual: CreditAnalysisPayload,
): boolean {
  if (!anterior) return true
  return (
    (anterior.status ?? null) !== (textoOuNulo(atual.status) ?? null) ||
    Number(anterior.credit_limit ?? 0) !== Number(atual.creditLimit ?? 0) ||
    Number(anterior.available_limit ?? 0) !== Number(atual.availableLimit ?? 0) ||
    Number(anterior.monthly_rate_d0 ?? 0) !== Number(atual.monthlyRateD0 ?? 0)
  )
}

async function gravarSnapshotCredito(
  cnpj: string,
  credito: CreditAnalysisPayload | null,
  empresaId: string | null,
): Promise<{ gravado: boolean; evento: boolean }> {
  if (!credito) return { gravado: false, evento: false }

  const { data: anterior } = await supabaseAdmin
    .from('credito_snapshots')
    .select('status, credit_limit, available_limit, monthly_rate_d0')
    .eq('cnpj', cnpj)
    .order('capturado_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!creditoMudou(anterior, credito)) return { gravado: false, evento: false }

  const { error } = await supabaseAdmin.from('credito_snapshots').insert({
    cnpj,
    status: textoOuNulo(credito.status),
    role: textoOuNulo(credito.role),
    via_headquarters: credito.viaHeadquarters ?? null,
    credit_limit: numeroOuNulo(credito.creditLimit),
    available_limit: numeroOuNulo(credito.availableLimit),
    consumed_limit: numeroOuNulo(credito.consumedLimit),
    expiration_date: dataOuNulo(credito.expirationDate),
    monthly_rate_d0: numeroOuNulo(credito.monthlyRateD0),
    monthly_rate_d1: numeroOuNulo(credito.monthlyRateD1),
    // Quando `via_headquarters`, a análise é da MATRIZ. O snapshot continua
    // indexado pelo sacado (é a nota dele), e esta coluna é o referente que
    // torna a flag legível.
    analisado_cnpj: cnpjOuNulo(credito.analyzedTaxId),
    origem: 'sync_nf',
  })
  if (error) {
    logger.error({ cnpj, erro: error.message }, 'Falha ao gravar snapshot de crédito.')
    return { gravado: false, evento: false }
  }

  // Só o PRIMEIRO snapshot não é notícia. Depois dele, toda mudança relevante é —
  // em especial um downgrade, que é o que a regra de notificação do Crédito pega.
  if (anterior) {
    const caiu =
      Number(credito.availableLimit ?? 0) < Number(anterior.available_limit ?? 0) ||
      (anterior.status === 'APPROVED' && textoOuNulo(credito.status) !== 'APPROVED')
    await emitirEvento(empresaId, EVENTO_TIPOS.SACADO_CREDITO_ALTERADO, {
      titulo: caiu ? 'Crédito do sacado piorou' : 'Crédito do sacado alterado',
      resumo:
        `${cnpj}: status ${anterior.status ?? '—'} → ${textoOuNulo(credito.status) ?? '—'}, ` +
        `disponível ${formatarMoeda(Number(anterior.available_limit ?? 0))} → ` +
        `${formatarMoeda(Number(credito.availableLimit ?? 0))}.`,
      url: '/antecipacao/sacados',
      cnpj,
      downgrade: caiu,
    })
    return { gravado: true, evento: true }
  }

  return { gravado: true, evento: false }
}

// ─── Empresas e fila de lookup ──────────────────────────────────────────────

interface EmpresaResolvida {
  empresaId: string | null
  /** Já temos dado cadastral dele (empresas ou mercado_universo)? */
  conhecido: boolean
}

/**
 * Liga o CNPJ a `empresas` quando ele JÁ existe, e cria a empresa quando o
 * participante está cadastrado na plataforma (espelha o sync de clientes). Um
 * CNPJ que só apareceu numa nota e não é cliente NÃO vira `empresas`: seria
 * inflar o CRM com dezenas de milhares de fornecedores que ninguém trabalha.
 * Ele vai para a fila de lookup e passa a existir em `mercado_universo`.
 */
async function resolverEmpresa(
  cnpj: string,
  participante: ParticipantePayload | null,
): Promise<EmpresaResolvida> {
  const { data: existente } = await supabaseAdmin
    .from('empresas')
    .select('id')
    .eq('cnpj', cnpj)
    .maybeSingle()
  if (existente) return { empresaId: existente.id, conhecido: true }

  // As DERIVADAS (camada, grupo_id, is_spe, grafo_sefaz) vêm junto, e não é detalhe: são
  // cópias denormalizadas do universo, e a ficha só mostra a aba "Grupo econômico" quando
  // `empresas.grupo_id` existe. Sem elas o universo sabia o grupo e a empresa não — a aba
  // nunca aparecia, a camada sumia da leitura de pirâmide e a SPE não entrava na análise
  // financeira do grupo. Foi o que a migração 0072 teve de reparar.
  const { data: universo } = await supabaseAdmin
    .from('mercado_universo')
    .select(
      'cnpj, empresa_id, razao_social, nome_fantasia, uf, municipio, cnae_principal, porte_rfb, camada, grupo_id, is_spe, grafo_sefaz',
    )
    .eq('cnpj', cnpj)
    .maybeSingle()

  if (!participante?.registered) {
    return { empresaId: universo?.empresa_id ?? null, conhecido: universo !== null }
  }

  const { data: nova, error } = await supabaseAdmin
    .from('empresas')
    .insert({
      cnpj,
      razao_social: universo?.razao_social ?? textoOuNulo(participante.name),
      nome_fantasia: universo?.nome_fantasia ?? null,
      uf: universo?.uf ?? null,
      municipio: universo?.municipio ?? null,
      cnae_principal: universo?.cnae_principal ?? null,
      porte: universo?.porte_rfb ?? null,
      camada: universo?.camada ?? null,
      grupo_id: universo?.grupo_id ?? null,
      is_spe: universo?.is_spe ?? false,
      grafo_sefaz: universo?.grafo_sefaz ?? false,
      tipo: 'fornecedor',
      estagio: 'mercado',
      origem: 'antecipacao',
    })
    .select('id')
    .single()

  if (error || !nova) {
    logger.error({ cnpj, erro: error?.message }, 'Falha ao criar empresa a partir da NF.')
    return { empresaId: universo?.empresa_id ?? null, conhecido: universo !== null }
  }

  if (universo) {
    await supabaseAdmin.from('mercado_universo').update({ empresa_id: nova.id }).eq('cnpj', cnpj)
  }
  return { empresaId: nova.id, conhecido: true }
}

/** Fila de enriquecimento cadastral (§3.1). Só para quem não tem dado nenhum. */
async function enfileirarLookup(
  cnpj: string,
  motivo: 'fornecedor_nf' | 'sacado_nf',
  conhecido: boolean,
): Promise<number> {
  if (conhecido) return 0
  const { error } = await supabaseAdmin
    .from('cnpj_lookup_fila')
    .upsert({ cnpj, motivo }, { onConflict: 'cnpj', ignoreDuplicates: true })
  if (error) {
    logger.error({ cnpj, erro: error.message }, 'Falha ao enfileirar CNPJ para lookup.')
    return 0
  }
  return 1
}

// ─── Tipagem do fornecedor ──────────────────────────────────────────────────

/**
 * O cache em `empresas.tipagem_antecipacao`. A view `notas_funil` calcula a
 * tipagem ao vivo (é o que a regra de faixa lê); isto existe para a Company 360
 * e para o evento de mudança, que é o que avisa o comercial que um fornecedor
 * saiu de "nunca antecipou" para "já antecipou".
 */
async function atualizarTipagem(
  empresaId: string | null,
  cnpj: string,
  cadastrado: boolean,
): Promise<void> {
  if (!empresaId) return

  const [{ data: empresa }, { data: cliente }] = await Promise.all([
    supabaseAdmin
      .from('empresas')
      .select('tipagem_antecipacao, ultima_antecipacao, razao_social')
      .eq('id', empresaId)
      .maybeSingle(),
    supabaseAdmin.from('clientes_onepay').select('last_anticipation').eq('cnpj', cnpj).maybeSingle(),
  ])
  if (!empresa) return

  const ultima = cliente?.last_anticipation
    ? cliente.last_anticipation.slice(0, 10)
    : (empresa.ultima_antecipacao ?? null)
  const nova = calcularTipagem({ cadastrado, jaAntecipou: ultima !== null })

  if (nova === empresa.tipagem_antecipacao && ultima === empresa.ultima_antecipacao) return

  await supabaseAdmin
    .from('empresas')
    .update({ tipagem_antecipacao: nova, ultima_antecipacao: ultima })
    .eq('id', empresaId)

  if (empresa.tipagem_antecipacao && nova !== empresa.tipagem_antecipacao) {
    await emitirEvento(empresaId, EVENTO_TIPOS.FORNECEDOR_TIPAGEM_ALTERADA, {
      resumo: `${empresa.razao_social ?? cnpj}: tipagem ${empresa.tipagem_antecipacao} → ${nova}.`,
      de: empresa.tipagem_antecipacao,
      para: nova,
    })
  }
}

// ─── Promoção do resumo (resNFe → XML completo) ─────────────────────────────

/**
 * Quantos DIAS DE EMISSÃO relemos por corrida.
 *
 * O recorte é por dia e não por nota porque o endpoint filtra por emissão, não
 * por chave: pedir uma nota específica custa a mesma requisição que pedir o dia
 * inteiro dela, e o dia inteiro traz de brinde exatamente o que falta — as notas
 * que entraram na plataforma DEPOIS da nossa primeira passada por aquele dia.
 */
const DIAS_DE_RESUMO_POR_CORRIDA = 8

export interface ResultadoPromocao {
  dias: string[]
  pendentes_antes: number
  pendentes_depois: number
  promovidas: number
  sync: ResultadoSyncNfs | null
}

/**
 * Relê as notas que chegaram em RESUMO, para pegá-las já completas.
 *
 * A NFe de material entra primeiro como `resNFe`: a SEFAZ entrega ao destinatário
 * um resumo — chave, emitente e valor — e o XML completo só aparece depois da
 * manifestação. Enquanto isso a nota existe no funil, mas sem itens e com
 * vencimento ESTIMADO (emissão + 30), que é um palpite ocupando o lugar da
 * duplicata real.
 *
 * Por que não bastava esperar o sync de 4 em 4 horas: o incremental pergunta "o
 * que foi SINCRONIZADO nas últimas 4h", e a promoção do XML nem sempre mexe no
 * `syncedAt` do outro lado. A nota fica parada em resumo até alguém reler a janela
 * de emissão dela — e é isso que este job faz, do resumo mais antigo para o mais
 * novo.
 *
 * Não é insert-only, de propósito: promover é exatamente sobrescrever a linha com
 * a versão completa dela.
 */
export async function promoverResumosDeNf(): Promise<ResultadoPromocao> {
  const pendentes = await supabaseAdmin
    .from('notas_fiscais')
    .select('emitida_em')
    .eq('xml_resumo', true)
    .not('emitida_em', 'is', null)
    // `nulls first`: quem nunca foi relido vem antes de quem já teve uma chance.
    .order('resumo_relido_em', { ascending: true, nullsFirst: true })
    .order('emitida_em', { ascending: false })
    .limit(2_000)

  const dias = [
    ...new Set(
      (pendentes.data ?? [])
        .map((l) => dataOuNulo((l as { emitida_em: string | null }).emitida_em))
        .filter((d): d is string => d !== null),
    ),
  ].slice(0, DIAS_DE_RESUMO_POR_CORRIDA)

  const antes = await contarResumosPendentes()
  if (dias.length === 0) {
    return { dias: [], pendentes_antes: antes, pendentes_depois: antes, promovidas: 0, sync: null }
  }

  const sync = await sincronizarNotasFiscais('incremental', {
    requisicoes: dias.map((d) => ({ tipo: 'datas', de: d, ate: d }) as RequisicaoSync),
    descricao: `promoção de resumos: ${dias.length} dia(s) de emissão (${dias.at(-1)} … ${dias[0]})`,
  })

  /*
   * O carimbo vai em TODAS as notas daqueles dias que continuam em resumo, e não
   * só nas que mudaram. Sem isso o job releria eternamente os mesmos dias: uma
   * nota que ainda não foi manifestada não vai virar completa hoje, e precisa ir
   * para o fim da fila para dar a vez à próxima.
   */
  await supabaseAdmin
    .from('notas_fiscais')
    .update({ resumo_relido_em: new Date().toISOString() } as never)
    .eq('xml_resumo', true)
    .gte('emitida_em', `${dias.at(-1)}T00:00:00Z`)
    .lte('emitida_em', `${dias[0]}T23:59:59Z`)

  const depois = await contarResumosPendentes()
  logger.info(
    { dias, promovidas: sync.promovidas, pendentes: depois },
    'Promoção de resumos concluída.',
  )
  return {
    dias,
    pendentes_antes: antes,
    pendentes_depois: depois,
    promovidas: sync.promovidas,
    sync,
  }
}

async function contarResumosPendentes(): Promise<number> {
  const { count } = await supabaseAdmin
    .from('notas_fiscais')
    .select('access_key', { count: 'exact', head: true })
    .eq('xml_resumo', true)
  return count ?? 0
}

// ─── Recuperação de uma janela de emissão ───────────────────────────────────

/**
 * Traz o que NÃO entrou numa janela de emissão, sem tocar no que já está gravado.
 *
 * É o conserto do buraco de 13/09/2026: entre a migração da plataforma e a
 * correção do valor da NFS-e, 9.463 notas foram descartadas por `sem_valor` e
 * nunca mais foram pedidas — o incremental só enxerga quatro horas para trás.
 *
 * INSERT-ONLY porque recuperar o que faltou e reescrever o que já existe são
 * decisões diferentes, e só a primeira foi pedida: uma nota que já está aqui pode
 * ter estágio movido, vendedor atribuído ou `operavel_manual` — trabalho humano
 * que uma releitura de três meses apagaria em silêncio.
 */
export async function recuperarNotasPorEmissao(
  de: string,
  ate: string,
): Promise<ResultadoSyncNfs> {
  const cfg = await lerConfigSync()
  const inicio = new Date(`${de}T00:00:00Z`)
  const fim = new Date(`${ate}T00:00:00Z`)
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || inicio > fim) {
    throw new Error(`Janela inválida para recuperação de NFs: ${de} … ${ate}.`)
  }

  // Blocos de 10 dias: é o teto do endpoint, e estourá-lo é 400 na cara.
  const requisicoes = fatiarJanela(inicio, fim, cfg.intervalo_max_dias)
  logger.info({ de, ate, blocos: requisicoes.length }, 'Recuperação de NFs por emissão iniciada.')

  return sincronizarNotasFiscais('incremental', {
    requisicoes,
    descricao: `recuperação insert-only por emissão: ${de} … ${ate}`,
    apenasNovas: true,
  })
}
