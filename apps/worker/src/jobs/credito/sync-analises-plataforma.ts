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
 * SÓ `drawee` entra na tabela — cedente não é cliente neste sentido, e misturá-lo
 * faria fornecedor aparecer como ex-cliente da carteira. Mas o RECORTE É NOSSO: o
 * pedido vai sem filtro de papel e o descarte acontece aqui, o que faz o censo do
 * resultado mostrar o que a fonte de fato manda. Filtro do servidor é invisível; o
 * nosso denuncia quando a fonte muda de ideia.
 *
 * O CONTRATO DA FONTE, que mudou uma vez e vai mudar de novo:
 *   - uma linha por par empresa+papel, com a análise mais recente daquele papel;
 *   - três status: `to_approve`, `approved`, `blocked` (não existe `expired`);
 *   - `everApproved` agregado sobre todo o histórico do par, independente do filtro;
 *   - documento sem cadastro na plataforma não é devolvido;
 *   - a análise é do documento da MATRIZ — filial não gera linha.
 *
 * As duas últimas apagaram dois problemas na origem: a lista "analisada e nunca
 * cadastrada" perdeu a fonte, e as filiais de matriz ativa pararam de chegar.
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
  /**
   * O par empresa+papel já teve aprovação em ALGUM momento — agregado sobre todo o
   * histórico e independente do filtro de status. É a resposta autoritativa para
   * "foi cliente?", e substitui o proxy que a gente usava (limite concedido > 0).
   */
  everApproved?: boolean | null
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
  total?: number
  totalItems?: number
  page_size?: number
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
  /**
   * O envelope de paginação como o servidor o devolveu, por página.
   *
   * Existe porque "veio tudo?" foi a primeira pergunta da primeira carga, e a
   * resposta estava fora do alcance: 74 itens em 2 páginas com `pageSize=200`
   * pedido só faz sentido se o servidor IGNORA o nosso tamanho e usa o dele (50).
   * Guardar o envelope torna isso conferível no meta da ingestão em vez de
   * dedutível — e denuncia na hora se um dia `totalPages` vier menor que o número
   * de páginas realmente necessárias.
   */
  paginacao: { passada: string; page: number; pageSize: number | null; totalPages: number | null; total: number | null; itens: number }[]
  /**
   * Quantas análises vieram de cada `status`, ANTES de qualquer recorte nosso.
   *
   * Existe porque a especificação errou o vocabulário uma vez: previa
   * `approved | expired` e a fonte devolve `approved | blocked`. Um censo no meta da
   * ingestão transforma "quais status existem?" numa pergunta que se responde
   * olhando a tela, em vez de um curl com credencial de produção.
   */
  recebido_por_status: Record<string, number>
  /**
   * CNPJs distintos vistos na corrida. Comparado com `itens`, denuncia se a fonte
   * está entregando uma análise por empresa (74/74 na primeira carga) ou o histórico.
   */
  cnpjs_distintos: number
  /** Linhas de cedente descartadas: a tabela é só de sacado. */
  descartados_assignor: number
  /** Filiais de matriz ativa e SPEs de grupo ativo — não são perda de cliente. */
  filiais_e_spes_ignoradas: number
  /** Quantas marcações erradas de corridas anteriores foram desfeitas. */
  desmarcados: number
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
    paginacao: [],
    recebido_por_status: {},
    cnpjs_distintos: 0,
    descartados_assignor: 0,
    filiais_e_spes_ignoradas: 0,
    desmarcados: 0,
  }

  /** Os CNPJs tocados nesta corrida. A classificação só olha para eles. */
  const cnpjs = new Set<string>()

  /*
   * DUAS PASSADAS, e a segunda é o que conserta a data da saída.
   *
   * A fonte devolve UMA linha por par empresa+papel: a análise mais recente daquele
   * papel. Sem filtro vêm os três status (to_approve, approved, blocked) — é a foto
   * de HOJE. Com `status=approved` vem o par cuja análise APROVADA é a mais recente,
   * mesmo que a vigente já seja outra — é a foto de QUANDO A PORTA FECHOU.
   *
   * Para um ex-cliente as duas diferem, e é a segunda que importa: `ex_cliente_desde`
   * e "último limite aprovado" saem da aprovada, não da bloqueada que a substituiu.
   * Como a tabela é chaveada por `analysis.id`, as duas passadas fazem upsert de
   * linhas DIFERENTES — o histórico se acumula sozinho, que é o que faltava.
   *
   * `page_size` em snake_case: era `pageSize` e o servidor ignorava em silêncio,
   * usando o default de 50. Mesma família do `.limit()` que já custou 800 linhas.
   */
  const passadas: { rotulo: string; query: string }[] = [
    { rotulo: 'todos_os_status', query: '' },
    { rotulo: 'somente_aprovadas', query: '&status=approved' },
  ]

  for (const passada of passadas) {
  let page = 1
  let totalPages = 1
  do {
    /*
     * SEM filtro de `role`: trazemos tudo e recortamos aqui. O recorte continua o
     * mesmo — só `drawee` entra em `analises_plataforma` — mas feito no nosso código
     * ele fica visível no censo, que é como se descobre que a fonte mudou de ideia.
     */
    const url = `${base}/api/v1/credit-analyses?page=${page}&page_size=${PAGE_SIZE}${passada.query}`
    const resp = await requisitarJson<RespostaAnalises>(url, {
      headers: autorizacao(),
      timeoutMs: 60_000,
    })
    totalPages = Math.max(1, resp.totalPages ?? 1)

    const itensDaPagina = extrair(resp)
    acc.paginacao.push({
      passada: passada.rotulo,
      page,
      pageSize: resp.pageSize ?? resp.page_size ?? null,
      totalPages: resp.totalPages ?? null,
      total: resp.total ?? resp.totalItems ?? null,
      itens: itensDaPagina.length,
    })

    for (const item of itensDaPagina) {
      acc.itens++

      // O censo do que a fonte devolve, antes de qualquer recorte nosso. É ele que
      // responde, na página de Ingestões, QUAIS status e papéis existem de verdade —
      // foi assim que `blocked` apareceu no lugar do `expired` que a spec previa.
      const papel = (item.analysis?.role ?? 'sem_role').trim().toLowerCase()
      const st = (item.analysis?.status ?? 'sem_status').trim().toLowerCase()
      const chave = `${papel}/${st}`
      acc.recebido_por_status[chave] = (acc.recebido_por_status[chave] ?? 0) + 1

      // Cedente não é cliente neste sentido: fornecedor viraria ex-cliente da carteira.
      if (papel !== 'drawee') {
        acc.descartados_assignor++
        continue
      }

      const r = await gravarAnalise(item)
      if (!r) continue
      acc.analises_upsert++
      if (r.statusAlterado) acc.status_alterados++
      if (r.snapshot) acc.snapshots_credito++
      cnpjs.add(r.cnpj)
    }

    /*
     * Uma página CHEIA na última volta é suspeita: significa que o servidor tinha
     * exatamente o que cabia, e `totalPages` pode estar mentindo (ou ter sido
     * calculado sobre outro tamanho de página). Avisar é melhor que parar em
     * silêncio — foi um `.limit()` ignorado em silêncio que já custou 800 linhas
     * na lista de fornecedores a prospectar.
     */
    const tamanho = resp.pageSize ?? PAGE_SIZE
    if (page === totalPages && itensDaPagina.length >= tamanho) {
      logger.warn(
        { page, totalPages, itens: itensDaPagina.length, pageSize: tamanho },
        'Última página veio cheia — pode haver mais análises do que totalPages indica.',
      )
    }
    page++
  } while (page <= totalPages)

  acc.paginas += totalPages
  } // fim das passadas

  acc.cnpjs_distintos = cnpjs.size

  for (const cnpj of cnpjs) {
    const r = await classificar(cnpj, hoje)
    acc.cnpjs_classificados++
    if (r === 'ex_cliente') acc.novos_ex_clientes++
    if (r === 'conflito') acc.conflitos++
    if (r === 'analise_sem_cadastro') acc.sem_cadastro++
    if (r === 'grupo_ainda_cliente' || r === 'desmarcado_grupo_ativo') acc.filiais_e_spes_ignoradas++
    if (r === 'desmarcado_grupo_ativo') acc.desmarcados++
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
    company_type: item.company?.companyType?.trim() || null,
    role: (analysis?.role ?? 'drawee').trim().toLowerCase() || 'drawee',
    ever_approved: analysis?.everApproved ?? null,
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
    .select('status, expiration_date, empresa_cadastrada, credit_limit, consumed_limit, monthly_rate_d0, ever_approved')
    .eq('cnpj', cnpj)
    .eq('role', 'drawee')

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
      raizTemClienteAtivo: await raizTemClienteAtivo(cnpj),
      grupoTemClienteAtivo: await grupoTemClienteAtivo(cnpj),
    },
    hoje,
  )

  let empresa = await lerEmpresa(cnpj)

  switch (r.situacao) {
    case 'ex_cliente': {
      /*
       * A empresa PODE NÃO EXISTIR no nosso CRM, e isso é o caso comum e não a
       * exceção: na primeira carga real, 18 dos 21 ex-clientes não tinham ficha.
       * Faz sentido — quem saiu antes de o CRM existir nunca foi promovido por
       * nenhum sync, e o do temperature report só enxerga quem está ativo hoje.
       *
       * Pular esses seria perder justamente os mais antigos. Criar a ficha é o que
       * o sync de clientes já faz para o cliente novo (`resolverEmpresa`), pelo
       * mesmo motivo: sem `empresas` não há timeline, contato nem estágio — ou seja,
       * não há onde registrar que ele foi cliente.
       */
      if (!empresa) {
        empresa = await criarEmpresaDeExCliente(cnpj)
        if (!empresa) return 'falha_ao_criar_empresa'
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

    case 'grupo_ainda_cliente': {
      /*
       * DESFAZ marcação anterior. A primeira carga rebaixou 5 filiais de matriz ativa
       * e 1 SPE de grupo ativo antes deste guard existir; sem esta correção elas
       * ficariam como ex-clientes para sempre, e não só na lista — `e_ex_cliente` no
       * Explorador e a exclusão do SDR leem o mesmo estágio.
       *
       * Volta para `mercado`, e não para `cliente`: filial e SPE não são clientes
       * (quem é são a matriz e a holding), e promovê-las inflaria a contagem da
       * carteira. `mercado` é o estado neutro de "empresa que conhecemos".
       */
      if (empresa?.estagio === 'ex_cliente') {
        await supabaseAdmin
          .from('empresas')
          .update({
            estagio: 'mercado',
            ex_cliente_desde: null,
            ex_cliente_motivo: null,
            ex_cliente_motivo_obs: null,
          })
          .eq('id', empresa.id)
        logger.info({ cnpj }, 'Ex-cliente desfeito: filial/SPE com matriz ou grupo ativo.')
        return 'desmarcado_grupo_ativo'
      }
      return 'grupo_ainda_cliente'
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

type EmpresaMin = {
  id: string
  estagio: string
  razao_social: string | null
  ex_cliente_desde: string | null
  teve_analise_sem_cadastro: boolean
}

async function lerEmpresa(cnpj: string): Promise<EmpresaMin | null> {
  const { data } = await supabaseAdmin
    .from('empresas')
    .select('id, estagio, razao_social, ex_cliente_desde, teve_analise_sem_cadastro')
    .eq('cnpj', cnpj)
    .maybeSingle()
  return (data as EmpresaMin | null) ?? null
}

/**
 * Cria a ficha de quem foi cliente e saiu antes de o CRM conhecê-lo.
 *
 * Espelha `resolverEmpresa` do sync de clientes (03), inclusive nas DERIVADAS
 * (camada, grupo, is_spe, grafo_sefaz) copiadas do universo: sem `grupo_id` a ficha
 * não mostra a aba de grupo econômico, e quem tem SPE costuma ser exatamente este
 * perfil. Nasce já como `ex_cliente` — passar por `cliente` acenderia, por um
 * instante, um cliente que não existe, e o evento de estágio junto.
 *
 * `origem: 'onepay'` porque a fonte é a mesma plataforma; o nome vem do universo e,
 * na falta dele, da própria análise.
 */
async function criarEmpresaDeExCliente(cnpj: string): Promise<EmpresaMin | null> {
  const { data: mu } = await supabaseAdmin
    .from('mercado_universo')
    .select(
      'razao_social, nome_fantasia, uf, municipio, cnae_principal, porte_rfb, camada, grupo_id, is_spe, grafo_sefaz',
    )
    .eq('cnpj', cnpj)
    .maybeSingle()

  const { data: analise } = await supabaseAdmin
    .from('analises_plataforma')
    .select('company_name')
    .eq('cnpj', cnpj)
    .not('company_name', 'is', null)
    .limit(1)
    .maybeSingle()

  const { data: nova, error } = await supabaseAdmin
    .from('empresas')
    .insert({
      cnpj,
      razao_social: mu?.razao_social ?? analise?.company_name ?? null,
      nome_fantasia: mu?.nome_fantasia ?? null,
      uf: mu?.uf ?? null,
      municipio: mu?.municipio ?? null,
      cnae_principal: mu?.cnae_principal ?? null,
      porte: mu?.porte_rfb ?? null,
      camada: mu?.camada ?? null,
      grupo_id: mu?.grupo_id ?? null,
      is_spe: mu?.is_spe ?? false,
      grafo_sefaz: mu?.grafo_sefaz ?? false,
      tipo: 'construtora',
      estagio: 'ex_cliente',
      origem: 'onepay',
    })
    .select('id, estagio, razao_social, ex_cliente_desde, teve_analise_sem_cadastro')
    .single()

  if (error || !nova) {
    logger.error({ cnpj, erro: error?.message }, 'Falha ao criar empresa de ex-cliente.')
    return null
  }

  // Liga o universo à ficha nova, como as outras promoções fazem.
  await supabaseAdmin.from('mercado_universo').update({ empresa_id: nova.id }).eq('cnpj', cnpj)
  return nova as EmpresaMin
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
 * Existe cliente ATIVO em outro CNPJ da mesma raiz (mesmos 8 dígitos)?
 *
 * Filial não é empresa, é endereço da mesma pessoa jurídica — e a plataforma abriu
 * análise por filial no passado. Sem esta pergunta, a VALKA CONSTRUÇÕES aparecia
 * quatro vezes como ex-cliente (uma por filial) sendo cliente ativa o tempo todo.
 */
async function raizTemClienteAtivo(cnpj: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from('clientes_onepay')
    .select('cnpj', { count: 'exact', head: true })
    .like('cnpj', `${cnpj.slice(0, 8)}%`)
    .eq('status', 'active')
  return (count ?? 0) > 0
}

/**
 * Existe cliente ATIVO em outro CNPJ do mesmo grupo econômico?
 *
 * A prática antiga de abrir análise por SPE deixou este rastro: a SPE é veículo de
 * obra e some quando a obra acaba, mas o cliente é a holding, que continua operando.
 */
async function grupoTemClienteAtivo(cnpj: string): Promise<boolean> {
  const { data: emp } = await supabaseAdmin
    .from('empresas')
    .select('grupo_id')
    .eq('cnpj', cnpj)
    .maybeSingle()

  // Sem grupo conhecido, tenta pelo universo: a empresa pode nem ter ficha ainda.
  let grupoId = emp?.grupo_id ?? null
  if (!grupoId) {
    const { data: mu } = await supabaseAdmin
      .from('mercado_universo')
      .select('grupo_id')
      .eq('cnpj', cnpj)
      .maybeSingle()
    grupoId = mu?.grupo_id ?? null
  }
  if (!grupoId) return false

  const { data: irmas } = await supabaseAdmin
    .from('mercado_universo')
    .select('cnpj')
    .eq('grupo_id', grupoId)
    .neq('cnpj', cnpj)
  const cnpjs = (irmas ?? []).map((i) => i.cnpj)
  if (cnpjs.length === 0) return false

  const { count } = await supabaseAdmin
    .from('clientes_onepay')
    .select('cnpj', { count: 'exact', head: true })
    .in('cnpj', cnpjs)
    .eq('status', 'active')
  return (count ?? 0) > 0
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
