import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { normalizeCnpj } from '../../../../../packages/core/src/schemas/cnpj.js'
import {
  calcularReceitaEsperada,
  calcularTipagem,
  diasParaVencimento,
  formatarMoeda,
} from '../../../../../packages/core/src/antecipacao/economia.js'
import {
  extrairNotas,
  normalizarNfPayload,
  totalDePaginas,
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
  montarPlanoSync,
  querystringSync,
  type ModoSync,
} from '../../../../../packages/core/src/antecipacao/sync-plano.js'
import { lerConfigEconomia, lerConfigSync } from '../../antecipacao/config.js'
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
  falhas_parse: number
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
  const plano = montarPlanoSync({ modo, ultimoSync, agora: new Date(), cfg: cfgSync })
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
    falhas_parse: 0,
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
        const r = await processarNota(item, cfgEconomia.taxa_mensal_padrao)
        acc.notas++
        if (r.ignorada) acc.ignoradas++
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

interface ResultadoNota {
  ignorada: boolean
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

async function processarNota(item: NfPayload, taxaPadrao: number): Promise<ResultadoNota> {
  // Toda a leitura do payload (e do XML) acontece no core, testada contra o
  // payload real. Aqui só sobra o que precisa do banco.
  const r = normalizarNfPayload(item)
  if (!r.ok) {
    logger.warn({ id: r.id, motivo: r.motivo }, 'NF descartada no sync.')
    return NADA
  }
  const nota: NotaNormalizada = r.nota
  const { access_key: accessKey, fornecedor_cnpj: fornecedorCnpj, sacado_cnpj: sacadoCnpj } = nota

  const dias = diasParaVencimento(nota.vencimento)

  // `monthlyRateD0` é a taxa que precifica a nota; sem ela, o último snapshot do
  // sacado; sem nenhum, o default da config.
  const { receita, taxa } = calcularReceitaEsperada({
    valor: nota.valor,
    diasParaVencimento: dias,
    taxaMensal: nota.credito?.monthlyRateD0 ?? (await taxaDoUltimoSnapshot(sacadoCnpj)),
    taxaPadrao,
  })

  const [fornecedor, sacado] = await Promise.all([
    resolverEmpresa(fornecedorCnpj, item.supplier ?? null),
    resolverEmpresa(sacadoCnpj, item.recipient ?? null),
  ])

  const jaExistia = await notaExiste(accessKey)

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
    dias_para_vencimento: dias,
    credit_status: nota.credito?.status ?? null,
    credit_role: nota.credito?.role ?? null,
    credit_limite: nota.credito?.creditLimit ?? null,
    credit_disponivel: nota.credito?.availableLimit ?? null,
    raw_xml: nota.raw_xml,
    xml_parse_erro: nota.xml_parse_erro,
    sincronizada_em: nota.sincronizada_em,
  }

  const { error } = await supabaseAdmin.from('notas_fiscais').upsert(linha, { onConflict: 'access_key' })
  if (error) {
    logger.error({ accessKey, erro: error.message }, 'Falha no upsert da NF.')
    return NADA
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

async function notaExiste(accessKey: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('notas_fiscais')
    .select('access_key')
    .eq('access_key', accessKey)
    .maybeSingle()
  return data !== null
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
