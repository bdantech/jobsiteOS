import {
  classificarCnpj,
  type AnaliseDoCnpj,
} from '../../../../../packages/core/src/credito/ex-clientes.js'
import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { normalizeCnpj } from '../../../../../packages/core/src/schemas/cnpj.js'
import type { TablesInsert } from '../../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'
import { emitirEvento } from '../../radar/eventos.js'

/**
 * Sync das análises de crédito da plataforma e detecção de ex-clientes (04h §3).
 *
 * SEMPRE `role=drawee`. Sem o filtro viriam também as análises de cedente, e o
 * cedente não é cliente no sentido desta tela — misturá-los faria fornecedor
 * aparecer como ex-cliente da carteira.
 *
 * O QUE ESTE JOB NÃO FAZ: promover ninguém a `cliente`. Quem governa "é cliente
 * hoje" é o temperature report (03), e ter duas fontes promovendo produziria dois
 * relógios discordando. Aqui só se REBAIXA — e mesmo assim nunca contra o
 * temperature report, que ganha sempre (ver `classificarCnpj`).
 *
 * A classificação é por CNPJ e roda DEPOIS do upsert de todas as páginas, não por
 * item: um CNPJ costuma ter várias análises, e decidir na primeira delas leria um
 * conjunto pela metade — a empresa com uma análise vencida na página 1 e uma
 * vigente na página 3 seria rebaixada e depois restaurada, emitindo um evento de
 * saída que nunca aconteceu.
 */

interface CompanyPayload {
  id?: number | null
  name?: string | null
  taxId?: string | null
  accountType?: string | null
  isSubscriber?: boolean | null
  companyType?: string | null
}

interface AnalysisPayload {
  id?: number
  role?: string | null
  status?: string | null
  expirationDate?: string | null
  creditLimit?: number | null
  consumedLimit?: number | null
  availableLimit?: number | null
  commissionPercent?: number | null
  feeD0?: number | null
  minFeeD0?: number | null
  feeD1?: number | null
  minFeeD1?: number | null
  monthlyRateD0?: number | null
  monthlyRateD1?: number | null
  maxInvoiceDeadlineInDays?: number | null
  maxAnticipationValue?: number | null
  billFine?: number | null
  investBack?: unknown
  hasInsurance?: boolean | null
  hasReferral?: boolean | null
  fidcReady?: boolean | null
}

interface ItemAnalise {
  company?: CompanyPayload
  analysis?: AnalysisPayload
}

interface RespostaAnalises {
  data?: ItemAnalise[]
  items?: ItemAnalise[]
  page?: number
  pageSize?: number
  totalPages?: number
}

export interface ResultadoAnalises {
  paginas: number
  itens: number
  analises_upsert: number
  cnpjs_classificados: number
  novos_ex_clientes: number
  conflitos: number
  sem_cadastro: number
  snapshots_credito: number
  status_alterados: number
}

const PAGE_SIZE = 200
/** A janela em que uma conversão recente blinda o CNPJ contra o rebaixamento (§3). */
const DIAS_CONVERSAO_RECENTE = 60

function autorizacao(): Record<string, string> {
  return env.ONEPAY_BI_TOKEN ? { authorization: `Bearer ${env.ONEPAY_BI_TOKEN}` } : {}
}

function extrair(resp: RespostaAnalises): ItemAnalise[] {
  if (Array.isArray(resp.data)) return resp.data
  if (Array.isArray(resp.items)) return resp.items
  if (Array.isArray(resp)) return resp as ItemAnalise[]
  return []
}

function numeroOuNulo(v: unknown): number | null {
  const n = Number(v)
  return v === null || v === undefined || !Number.isFinite(n) ? null : n
}

function dataOuNulo(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim() === '') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/**
 * A REGRA DE OURO DA FONTE (§1): `company.id` **ou** `company.name` vazio significa
 * que a empresa teve análise e nunca foi cadastrada. É `&&` de propósito — exigir os
 * dois presentes, e não um deles, porque metade do cadastro é cadastro nenhum.
 */
function estaCadastrada(company: CompanyPayload | undefined): boolean {
  const temId = typeof company?.id === 'number' && company.id > 0
  const temNome = typeof company?.name === 'string' && company.name.trim() !== ''
  return temId && temNome
}

export async function sincronizarAnalisesPlataforma(): Promise<ResultadoAnalises> {
  if (!env.ONEPAY_BI_URL) {
    throw new Error('ONEPAY_BI_URL não configurado — configure o secret no worker antes de rodar.')
  }
  const base = env.ONEPAY_BI_URL.replace(/\/+$/, '')
  const hoje = new Date().toISOString().slice(0, 10)

  const acc: ResultadoAnalises = {
    paginas: 0,
    itens: 0,
    analises_upsert: 0,
    cnpjs_classificados: 0,
    novos_ex_clientes: 0,
    conflitos: 0,
    sem_cadastro: 0,
    snapshots_credito: 0,
    status_alterados: 0,
  }

  /** Os CNPJs tocados nesta corrida. A classificação só olha para eles. */
  const cnpjs = new Set<string>()

  let page = 1
  let totalPages = 1
  do {
    const url = `${base}/api/v1/credit-analyses?role=drawee&page=${page}&pageSize=${PAGE_SIZE}`
    const resp = await requisitarJson<RespostaAnalises>(url, {
      headers: autorizacao(),
      timeoutMs: 60_000,
    })
    totalPages = Math.max(1, resp.totalPages ?? 1)

    for (const item of extrair(resp)) {
      acc.itens++
      const r = await gravarAnalise(item)
      if (!r) continue
      acc.analises_upsert++
      if (r.statusAlterado) acc.status_alterados++
      if (r.snapshot) acc.snapshots_credito++
      cnpjs.add(r.cnpj)
    }
    page++
  } while (page <= totalPages)

  acc.paginas = totalPages

  for (const cnpj of cnpjs) {
    const r = await classificar(cnpj, hoje)
    acc.cnpjs_classificados++
    if (r === 'ex_cliente') acc.novos_ex_clientes++
    if (r === 'conflito') acc.conflitos++
    if (r === 'analise_sem_cadastro') acc.sem_cadastro++
  }

  logger.info(acc, 'Sync de análises da plataforma concluído.')
  return acc
}

// ─── Gravação ───────────────────────────────────────────────────────────────

async function gravarAnalise(
  item: ItemAnalise,
): Promise<{ cnpj: string; statusAlterado: boolean; snapshot: boolean } | null> {
  const analysis = item.analysis
  const idExterno = analysis?.id
  if (typeof idExterno !== 'number') return null

  const cnpj = normalizeCnpj(item.company?.taxId ?? '')
  if (cnpj.length !== 14) return null

  const status = (analysis?.status ?? '').trim()
  if (status === '') return null

  const { data: anterior } = await supabaseAdmin
    .from('analises_plataforma')
    .select('status, credit_limit, available_limit, monthly_rate_d0, cnpj')
    .eq('id_externo', idExterno)
    .maybeSingle()

  const linha: TablesInsert<'analises_plataforma'> = {
    id_externo: idExterno,
    cnpj,
    empresa_cadastrada: estaCadastrada(item.company),
    onepay_company_id: typeof item.company?.id === 'number' ? item.company.id : null,
    company_name: item.company?.name?.trim() || null,
    status,
    expiration_date: dataOuNulo(analysis?.expirationDate),
    credit_limit: numeroOuNulo(analysis?.creditLimit),
    consumed_limit: numeroOuNulo(analysis?.consumedLimit),
    available_limit: numeroOuNulo(analysis?.availableLimit),
    commission_percent: numeroOuNulo(analysis?.commissionPercent),
    fee_d0: numeroOuNulo(analysis?.feeD0),
    min_fee_d0: numeroOuNulo(analysis?.minFeeD0),
    fee_d1: numeroOuNulo(analysis?.feeD1),
    min_fee_d1: numeroOuNulo(analysis?.minFeeD1),
    monthly_rate_d0: numeroOuNulo(analysis?.monthlyRateD0),
    monthly_rate_d1: numeroOuNulo(analysis?.monthlyRateD1),
    max_invoice_deadline_days: numeroOuNulo(analysis?.maxInvoiceDeadlineInDays),
    max_anticipation_value: numeroOuNulo(analysis?.maxAnticipationValue),
    bill_fine: numeroOuNulo(analysis?.billFine),
    invest_back: (analysis?.investBack ?? null) as never,
    has_insurance: analysis?.hasInsurance ?? null,
    has_referral: analysis?.hasReferral ?? null,
    fidc_ready: analysis?.fidcReady ?? null,
    raw: item as never,
    sincronizada_em: new Date().toISOString(),
  }

  const { error } = await supabaseAdmin
    .from('analises_plataforma')
    .upsert(linha, { onConflict: 'id_externo' })
  if (error) {
    logger.error({ id_externo: idExterno, erro: error.message }, 'Falha no upsert da análise.')
    return null
  }

  const statusAlterado = Boolean(anterior) && (anterior?.status ?? null) !== status
  if (statusAlterado) {
    const empresaId = await empresaDoCnpj(cnpj)
    await emitirEvento(empresaId, EVENTO_TIPOS.ANALISE_PLATAFORMA_STATUS_ALTERADO, {
      titulo: 'Análise da plataforma mudou de status',
      resumo: `${item.company?.name ?? cnpj}: ${anterior?.status ?? '—'} → ${status}.`,
      url: empresaId ? `/empresas/${empresaId}` : '/empresas?tab=clientes',
      cnpj,
      de: anterior?.status ?? null,
      para: status,
    })
  }

  const snapshot = await gravarSnapshotCredito(cnpj, analysis, item.company)
  return { cnpj, statusAlterado, snapshot }
}

/**
 * As taxas e fees POR SACADO deste payload são mais ricas que as do sync de NF —
 * comissão, feeD0/D1, mínimos — e por isso alimentam a mesma série histórica
 * (`credito_snapshots`), com `origem = 'credit_analyses'` para que dê para saber de
 * onde cada ponto veio.
 *
 * Só grava quando MUDA. Um snapshot diário idêntico ao de ontem transformaria a série
 * de crédito num log de execução do cron.
 */
async function gravarSnapshotCredito(
  cnpj: string,
  analysis: AnalysisPayload | undefined,
  company: CompanyPayload | undefined,
): Promise<boolean> {
  if (!analysis) return false

  const { data: anterior } = await supabaseAdmin
    .from('credito_snapshots')
    .select('status, credit_limit, available_limit, monthly_rate_d0')
    .eq('cnpj', cnpj)
    .order('capturado_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  const status = (analysis.status ?? '').trim() || null
  const mudou =
    !anterior ||
    (anterior.status ?? null) !== status ||
    Number(anterior.credit_limit ?? 0) !== Number(analysis.creditLimit ?? 0) ||
    Number(anterior.available_limit ?? 0) !== Number(analysis.availableLimit ?? 0) ||
    Number(anterior.monthly_rate_d0 ?? 0) !== Number(analysis.monthlyRateD0 ?? 0)
  if (!mudou) return false

  const { error } = await supabaseAdmin.from('credito_snapshots').insert({
    cnpj,
    status,
    role: (analysis.role ?? 'drawee').trim() || 'drawee',
    credit_limit: numeroOuNulo(analysis.creditLimit),
    available_limit: numeroOuNulo(analysis.availableLimit),
    consumed_limit: numeroOuNulo(analysis.consumedLimit),
    expiration_date: dataOuNulo(analysis.expirationDate),
    monthly_rate_d0: numeroOuNulo(analysis.monthlyRateD0),
    monthly_rate_d1: numeroOuNulo(analysis.monthlyRateD1),
    origem: 'credit_analyses',
  })
  if (error) {
    logger.error({ cnpj, empresa: company?.name, erro: error.message }, 'Falha no snapshot de crédito.')
    return false
  }
  return true
}

// ─── Classificação ──────────────────────────────────────────────────────────

async function empresaDoCnpj(cnpj: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('empresas').select('id').eq('cnpj', cnpj).maybeSingle()
  return data?.id ?? null
}

async function classificar(cnpj: string, hoje: string): Promise<string> {
  const { data: analises } = await supabaseAdmin
    .from('analises_plataforma')
    .select('status, expiration_date, empresa_cadastrada, credit_limit, consumed_limit, monthly_rate_d0')
    .eq('cnpj', cnpj)

  const { data: cliente } = await supabaseAdmin
    .from('clientes_onepay')
    .select('status')
    .eq('cnpj', cnpj)
    .maybeSingle()

  const r = classificarCnpj(
    (analises ?? []) as AnaliseDoCnpj[],
    {
      statusOnepay: cliente?.status ?? null,
      converteuRecentemente: await converteuRecentemente(cnpj),
    },
    hoje,
  )

  const { data: empresa } = await supabaseAdmin
    .from('empresas')
    .select('id, estagio, razao_social, ex_cliente_desde, teve_analise_sem_cadastro')
    .eq('cnpj', cnpj)
    .maybeSingle()

  switch (r.situacao) {
    case 'ex_cliente': {
      // Sem empresa não há estágio para mexer. Acontece quando a análise é de um CNPJ
      // que nunca entrou em `empresas` — mas com `empresa_cadastrada = true` isso é
      // uma inconsistência entre a plataforma e a nossa base, não um ex-cliente.
      if (!empresa) {
        logger.warn({ cnpj }, 'Ex-cliente sem empresa na base — ignorado.')
        return 'sem_empresa'
      }
      if (empresa.estagio === 'ex_cliente' && empresa.ex_cliente_desde === r.exClienteDesde) {
        return 'ja_era_ex'
      }

      const motivoPadrao = await motivoDesconhecido()
      await supabaseAdmin
        .from('empresas')
        .update({
          estagio: 'ex_cliente',
          ex_cliente_desde: r.exClienteDesde,
          // O motivo só nasce na PRIMEIRA vez. Reescrevê-lo a cada corrida apagaria a
          // classificação que uma pessoa fez, que é o dado mais caro desta tela.
          ...(empresa.estagio === 'ex_cliente' ? {} : { ex_cliente_motivo: motivoPadrao }),
        })
        .eq('id', empresa.id)

      await emitirEvento(empresa.id, EVENTO_TIPOS.CLIENTE_TORNOU_EX, {
        titulo: 'Virou ex-cliente',
        resumo:
          `${empresa.razao_social ?? cnpj} não tem mais análise de crédito vigente ` +
          `(a última expirou em ${r.exClienteDesde ?? '—'}). Classifique o motivo da saída.`,
        url: `/empresas/${empresa.id}`,
        cnpj,
        ex_cliente_desde: r.exClienteDesde,
      })
      return 'ex_cliente'
    }

    case 'conflito': {
      if (!empresa) return 'conflito_sem_empresa'
      await emitirEvento(empresa.id, EVENTO_TIPOS.EXCLIENTE_CONFLITO_DADOS, {
        titulo: 'Ex-cliente com dado conflitante',
        resumo:
          `${empresa.razao_social ?? cnpj} está sem análise vigente, mas o temperature ` +
          `report diz que é cliente ativo (${r.motivoConflito}). Não foi rebaixado — revise.`,
        url: `/empresas/${empresa.id}`,
        cnpj,
        motivo: r.motivoConflito,
      })
      return 'conflito'
    }

    case 'analise_sem_cadastro': {
      // NÃO mexe no estágio: nunca foi cliente. Só marca — e cria a fila de lookup
      // quando o CNPJ é desconhecido, para a lista ter nome antes de alguém ligar.
      if (empresa) {
        if (!empresa.teve_analise_sem_cadastro) {
          await supabaseAdmin
            .from('empresas')
            .update({ teve_analise_sem_cadastro: true })
            .eq('id', empresa.id)
          await emitirEvento(empresa.id, EVENTO_TIPOS.ANALISE_SEM_CADASTRO, {
            titulo: 'Análise aprovada sem cadastro',
            resumo: `${empresa.razao_social ?? cnpj} tem análise aprovada e nunca operou na plataforma.`,
            url: `/empresas/${empresa.id}`,
            cnpj,
          })
        }
      } else {
        await supabaseAdmin
          .from('cnpj_lookup_fila')
          .upsert({ cnpj, motivo: 'manual', status: 'pendente' }, { onConflict: 'cnpj', ignoreDuplicates: true })
      }
      return 'analise_sem_cadastro'
    }

    default:
      return r.situacao
  }
}

/** O id de "Motivo desconhecido": o default do detector, explícito e contável. */
async function motivoDesconhecido(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('motivos_perda')
    .select('id')
    .eq('contexto', 'ex_cliente')
    .eq('motivo', 'Motivo desconhecido')
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Antecipação convertida (04e) nos últimos 60 dias. Quem operou há dois meses não é
 * ex-cliente, por mais vencida que a análise esteja — é atraso de renovação.
 */
async function converteuRecentemente(cnpj: string): Promise<boolean> {
  const desde = new Date(Date.now() - DIAS_CONVERSAO_RECENTE * 86_400_000).toISOString()
  const { count } = await supabaseAdmin
    .from('notas_fiscais')
    .select('access_key', { count: 'exact', head: true })
    .eq('fornecedor_cnpj', cnpj)
    .eq('estagio_funil', 'convertida')
    .gte('estagio_alterado_em', desde)
  if ((count ?? 0) > 0) return true

  const { count: comoSacado } = await supabaseAdmin
    .from('notas_fiscais')
    .select('access_key', { count: 'exact', head: true })
    .eq('sacado_cnpj', cnpj)
    .eq('estagio_funil', 'convertida')
    .gte('estagio_alterado_em', desde)
  return (comoSacado ?? 0) > 0
}
