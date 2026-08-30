import 'server-only'
import type { CamadaComRegra, PreviaRegra } from '@jobsiteos/core'

/**
 * The ONE place in the web app that talks to `apps/worker` (Railway).
 *
 * ─── WHY IT LIVES HERE AND NOT IN actions/mercado-worker.ts ─────────────────
 * A `'use server'` module may only export async functions, and every export it
 * has becomes a callable RPC endpoint reachable by any authenticated browser.
 * `dispararJob()` carries the WORKER_SECRET and must never be one of those: it
 * is called from an admin-gated server action AND from two cron routes, which
 * authorise very differently. So it sits in a plain server-only module that both
 * import, and the authorisation stays in the callers.
 *
 * WORKER_URL and WORKER_SECRET are SERVER-ONLY (never NEXT_PUBLIC_*). The
 * `server-only` import above turns an accidental client import into a build
 * error rather than a leaked bearer token. The secret is never logged, never put
 * in an error message, and never returned to the UI.
 */

/** fonte -> worker route. `lista` is deliberately absent: list imports are not a worker job. */
const ROTAS: Record<'receita_cnpj' | 'cno' | 'onepay_nf', string> = {
  receita_cnpj: '/jobs/receita',
  cno: '/jobs/cno',
  // O sync de NFs É uma ingestão (fonte `onepay_nf`, migration 0050), então
  // entra em ROTAS: é o que faz o botão "Reexecutar" da tela de Ingestões
  // funcionar para ele sem código novo.
  onepay_nf: '/jobs/antecipacao/sync-nfs',
}

/**
 * Reclassification is NOT a `mercado_ingestoes.fonte` — it is not an ingestion, it
 * reclassifies what was already ingested. So it gets its own route and stays out of
 * ROTAS, whose keys must remain exactly the fontes the Ingestões screen can re-fire.
 */
const ROTA_RECLASSIFICAR = '/jobs/reclassificar'

/**
 * SPEs + grupos econômicos + métricas, sem reimportar nada.
 *
 * Fica fora de ROTAS pelo mesmo motivo da reclassificação: não é uma ingestão, é um
 * recálculo sobre o que já foi ingerido. Existe porque essas três derivadas só rodavam
 * encadeadas na importação da Receita — 100 milhões de linhas e quatro horas para
 * refazer um cálculo de minutos. Quando o grafo de grupos sai errado (e ele saiu, em
 * 10/08/2026, quando a Receita mudou o formato do sócio PJ), reimportar tudo era a
 * única saída.
 */
const ROTA_DERIVADAS = '/jobs/metricas'

/** The subset of `mercado_ingestoes.fonte` the worker can actually run. */
export type JobWorker = keyof typeof ROTAS

export const JOBS_WORKER = Object.keys(ROTAS) as JobWorker[]

/** `fonte` comes back from Postgres as plain `text`. This is the boundary that types it. */
export function isJobWorker(fonte: string): fonte is JobWorker {
  return Object.prototype.hasOwnProperty.call(ROTAS, fonte)
}

export interface DispararJobInput {
  job: JobWorker
  /** Who pulled the trigger. The worker stores it in mercado_ingestoes.meta. */
  origem: 'cron' | 'admin'
  /**
   * Use the manual mirror (RECEITA_FALLBACK_URL / CNO fallback) instead of the
   * primary source. Spec §3.1: the fallback is NEVER automatic — only an admin,
   * only after a failed run. Cron must always pass false.
   */
  fallback: boolean
  /** The failed run this re-run descends from, for traceability in `meta`. */
  reexecucaoDe?: string
}

export type DispararJobResultado =
  /*
   * `corpo` é o JSON que o worker devolveu, cru.
   *
   * Quase todas as rotas respondem 202 com um id e nada mais a dizer — para elas ele
   * é ruído. Existe para a exceção do 04l: o clique de "Buscar contatos" roda SÍNCRONO
   * e devolve quanto custou e o que achou, e a tela precisa desse número porque ela
   * acabou de perguntar "posso gastar R$ 1,65?".
   */
  | { ok: true; ingestaoId: string | null; corpo?: unknown }
  | { ok: false; message: string; code: 'config' | 'rede' | 'worker' }

/**
 * The worker only ENQUEUES here (the real job runs for hours), so this call
 * should return in milliseconds. A generous ceiling still bounds a hung Railway
 * container instead of holding a Vercel function open until the platform kills it.
 */
const TIMEOUT_MS = 15_000

/** A worker error body could be an HTML stack trace. Keep it short and single-line. */
function trecho(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim()
  return limpo.length > 200 ? `${limpo.slice(0, 200)}…` : limpo
}

function ingestaoIdDe(corpo: unknown): string | null {
  if (typeof corpo !== 'object' || corpo === null) return null
  const registro = corpo as Record<string, unknown>
  const valor = registro.ingestao_id ?? registro.ingestaoId
  return typeof valor === 'string' && valor.length > 0 ? valor : null
}

/**
 * The ONE function that reads the secret and speaks HTTP. Every worker call in the
 * app funnels through here, so the bearer token has exactly one code path to leak
 * from — and it never does: it lives in a header, never in a log, never in a
 * returned message, never in an error.
 *
 * Never throws. Callers get a discriminated result they can turn into a pt-BR
 * message (server action) or an HTTP status (cron route).
 */
async function postar(
  rota: string,
  corpoJson: unknown,
  rotulo: string,
  /*
   * O teto padrão vale para enfileirar. O clique de descoberta é a exceção: ele
   * espera a cascata inteira (Nova Vida + Apollo + uma busca web do Claude), que
   * passa fácil de um minuto. Quinze segundos ali devolveriam "não foi possível
   * falar com o worker" para uma consulta que rodou e foi cobrada.
   */
  timeoutMs: number = TIMEOUT_MS,
): Promise<DispararJobResultado> {
  const baseUrl = process.env.WORKER_URL
  const secret = process.env.WORKER_SECRET

  // Fail closed and loudly: a deploy missing these must not look like a worker
  // that simply has nothing to do.
  if (!baseUrl || !secret) {
    return {
      ok: false,
      code: 'config',
      message: 'O worker do Mercado não está configurado (WORKER_URL / WORKER_SECRET).',
    }
  }

  let url: string
  try {
    url = new URL(rota, baseUrl).toString()
  } catch {
    return { ok: false, code: 'config', message: 'WORKER_URL inválida.' }
  }

  let resposta: Response
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(corpoJson),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // Do not surface `error` verbatim: on a bad WORKER_URL it contains the host.
    console.error('[mercado] falha de rede ao chamar o worker', {
      job: rotulo,
      erro: error instanceof Error ? error.name : 'desconhecido',
    })
    return {
      ok: false,
      code: 'rede',
      message: 'Não foi possível falar com o worker. Verifique se o serviço está no ar.',
    }
  }

  if (!resposta.ok) {
    const corpo = trecho(await resposta.text().catch(() => ''))
    console.error('[mercado] worker recusou o job', { job: rotulo, status: resposta.status })

    // 401/403 means OUR secret is wrong — an admin can fix that, so say it plainly.
    const message =
      resposta.status === 401 || resposta.status === 403
        ? 'O worker recusou a autenticação. Confira o WORKER_SECRET nos dois lados.'
        : `O worker respondeu ${resposta.status}${corpo ? `: ${corpo}` : '.'}`

    return { ok: false, code: 'worker', message }
  }

  const corpo: unknown = await resposta.json().catch(() => null)
  return { ok: true, ingestaoId: ingestaoIdDe(corpo), corpo }
}

/** Fire an ingestion job (Receita / CNO). */
export async function dispararJob(input: DispararJobInput): Promise<DispararJobResultado> {
  return postar(
    ROTAS[input.job],
    {
      fallback: input.fallback,
      origem: input.origem,
      reexecucao_de: input.reexecucaoDe ?? null,
    },
    input.job,
  )
}

/**
 * Fire the on-demand promotion (§3.2.5): turn every SAM+SOM company not yet in
 * `empresas` into a CRM row. Enqueue-only, like the other jobs — the worker runs
 * it in batches (minutes) and this returns as soon as it accepts the job. Idempotent
 * and resumable, so re-firing simply continues from where it stopped.
 */
export async function dispararPromocao(): Promise<DispararJobResultado> {
  return postar('/jobs/promover', {}, 'promover')
}

/**
 * Radar (§7): sync diário dos clientes Onepay. Enqueue-only como os demais — o
 * worker puxa o temperature-report paginado e atualiza clientes_onepay em segundo
 * plano. Sem corpo; a autorização (cron vs admin) fica no caller.
 */
export async function dispararSincronizarOnepay(): Promise<DispararJobResultado> {
  return postar('/jobs/radar/onepay', {}, 'radar-onepay')
}

/**
 * Radar (§6.3): executa um lote de enriquecimento APROVADO. Enqueue-only — o worker
 * materializa os itens, processa com throttle e teto de orçamento, e reconcilia o
 * custo em segundo plano. A aprovação (quem pode) fica no caller.
 */
export async function dispararLoteRadar(loteId: string): Promise<DispararJobResultado> {
  return postar('/jobs/radar/lote', { lote_id: loteId }, 'radar-lote')
}

/** Radar (§5): rotina mensal de protestos dos clientes (matriz + SPEs ativas, nacional). */
export async function dispararProtestosClientesMensal(): Promise<DispararJobResultado> {
  return postar('/jobs/radar/protestos-clientes', {}, 'radar-protestos-clientes')
}

/**
 * Radar: o aviso de custo da rotina mensal de protestos. Dispara nos dias 28–31 e o
 * worker só notifica no ÚLTIMO dia do mês — que é sempre exatamente cinco dias antes
 * da rodada do dia 5, em fevereiro como em março.
 */
export async function dispararAvisoCustoProtestos(): Promise<DispararJobResultado> {
  return postar('/jobs/radar/protestos-aviso', {}, 'radar-protestos-aviso')
}

// ─── Comercial (Prompt 04g) ─────────────────────────────────────────────────

/** Segunda de manhã: distribui empresas para os SDRs de saída. */
export async function dispararDistribuirSdr(): Promise<DispararJobResultado> {
  return postar('/jobs/comercial/distribuir-sdr', {}, 'comercial-distribuir')
}

/** Diário: SLA dos leads parados + vendedores sem movimento. */
export async function dispararSlaComercial(): Promise<DispararJobResultado> {
  return postar('/jobs/comercial/sla-leads', {}, 'comercial-sla')
}

/** Mensal: candidatas a conta passiva. Sugere; não muda nada. */
export async function dispararSugerirPassivos(): Promise<DispararJobResultado> {
  return postar('/jobs/comercial/sugerir-passivos', {}, 'comercial-passivos')
}

/** Mensal: fecha a competência anterior de comissão. */
export async function dispararApurarComissoes(competencia?: string): Promise<DispararJobResultado> {
  return postar('/jobs/comercial/apurar-comissoes', { competencia }, 'comercial-comissoes')
}

// ─── Motor de comissões v2 (04k) ────────────────────────────────────────────

/** Diário: titularidades, backfill das cessões e — só no último dia útil — o fecho. */
export async function dispararComissoesDiario(): Promise<DispararJobResultado> {
  return postar('/jobs/comercial/comissoes-diario', {}, 'comercial-comissoes-v2')
}

/** Fecho manual, para quando o último dia útil passou batido. */
export async function dispararFecharCompetencia(competencia?: string): Promise<DispararJobResultado> {
  return postar('/jobs/comercial/fechar-competencia', { competencia }, 'comercial-comissoes-v2')
}

/**
 * Horário — e também chamado na hora, logo depois de alguém decidir um aceite.
 *
 * O cron é a rede: se a chamada imediata se perder, o lançamento aparece na hora
 * seguinte em vez de nunca. É o mesmo desenho de `dispararRotearNotas`.
 */
export async function dispararAceitesSdr(): Promise<DispararJobResultado> {
  return postar('/jobs/comercial/aceites-sdr', {}, 'comercial-sdr-aceites')
}

/** Só a etapa de titularidade do diário — para rodar depois de mexer em carteira. */
export async function dispararLiberarDormentes(): Promise<DispararJobResultado> {
  return postar('/jobs/comercial/liberar-dormentes', {}, 'comercial-comissoes-v2')
}

/** Semanal: sinaliza contas passivas cujo volume desabou. */
export async function dispararAlertaReclassificacao(): Promise<DispararJobResultado> {
  return postar('/jobs/comercial/alerta-reclassificacao', {}, 'comercial-reclassificacao')
}

/*
 * Funil de cadastro de fornecedores (04l).
 *
 * As duas buscas ESPERAM o worker responder: a tela mostrou o custo estimado e
 * perguntou se pode gastar, e devolver "ok, mandei" para uma decisão de dinheiro é
 * pedir que a pessoa confie sem ver. As de lote seguem o padrão 202.
 *
 * A atualização do funil NÃO tem dispatcher aqui: ela roda atrás de cada sync de NF, e
 * a tela deixou de oferecer um botão para forçá-la. A rota do worker continua de pé
 * para quem opera — mas uma server action é um endpoint público para qualquer
 * navegador autenticado, e não se deixa um de pé sem quem o chame.
 */
export async function dispararDescobertaFornecedores(limite?: number): Promise<DispararJobResultado> {
  return postar(
    '/jobs/fornecedores/descoberta-automatica',
    limite ? { limite } : {},
    'fornecedores-descoberta',
  )
}

export async function dispararValidarContatos(): Promise<DispararJobResultado> {
  return postar('/jobs/fornecedores/validar-contatos', {}, 'fornecedores-validar')
}

/** A segunda busca, mais profunda. Ela vasculha mais fontes: teto de três minutos. */
export async function dispararBuscaAprofundada(input: {
  cnpj: string
  solicitadoPor?: string | null
  forcar?: boolean
}): Promise<DispararJobResultado> {
  return postar(
    '/jobs/fornecedores/buscar-contatos-aprofundado',
    { cnpj: input.cnpj, solicitado_por: input.solicitadoPor ?? undefined, forcar: input.forcar ?? false },
    'fornecedores-aprofundado',
    180_000,
  )
}

/** O clique pago. Síncrono, e por isso com teto de dois minutos. */
export async function dispararBuscarContatos(input: {
  cnpj: string
  solicitadoPor?: string | null
  forcar?: boolean
}): Promise<DispararJobResultado> {
  return postar(
    '/jobs/fornecedores/buscar-contatos',
    { cnpj: input.cnpj, solicitado_por: input.solicitadoPor ?? undefined, forcar: input.forcar ?? false },
    'fornecedores-clique',
    120_000,
  )
}

/** Reroteia as NFs vivas. Também roda encadeado no diário da Antecipação. */
export async function dispararDerivadas(): Promise<DispararJobResultado> {
  return postar(ROTA_DERIVADAS, {}, 'derivadas')
}

export async function dispararRotearNotas(): Promise<DispararJobResultado> {
  return postar('/jobs/comercial/rotear-nfs', {}, 'comercial-rotear')
}

/**
 * Radar (§5): protestos sob demanda de uma empresa (+ SPEs do grupo criadas a partir de
 * um ano). Ação PAGA — a autorização e a confirmação de custo ficam no caller (a aba
 * Análise financeira mostra a estimativa antes de disparar).
 */
export async function dispararProtestosEmpresa(input: {
  empresaId: string
  incluirSpes: boolean
  anoMin: number | null
  somenteAfiancadas?: boolean
}): Promise<DispararJobResultado> {
  return postar(
    '/jobs/radar/protestos-empresa',
    {
      empresa_id: input.empresaId,
      incluir_spes: input.incluirSpes,
      ano_min: input.anoMin,
      somente_afiancadas: input.somenteAfiancadas ?? false,
    },
    'radar-protestos-empresa',
  )
}

/**
 * Radar (§4): contatos do Apollo sob demanda de uma empresa. Ação PAGA — cobra por
 * contato revelado. O TTL de contatos vale, então clicar de novo dentro da janela
 * não cobra outra vez (o item volta `pulado`).
 */
/** Radar (04b §3): sync diário dos certificados digitais. Enqueue-only. */
export async function dispararSincronizarCertificados(): Promise<DispararJobResultado> {
  return postar('/jobs/radar/certificados', {}, 'radar-certificados')
}

export async function dispararContatosEmpresa(input: {
  empresaId: string
  revelarTelefone?: boolean
}): Promise<DispararJobResultado> {
  return postar(
    '/jobs/radar/contatos-empresa',
    { empresa_id: input.empresaId, revelar_telefone: input.revelarTelefone },
    'radar-contatos-empresa',
  )
}

/**
 * Cascata de domínio de uma empresa (Radar §3), do botão da ficha. É pré-requisito dos
 * outros dois botões: contatos e headcount consultam o Apollo POR DOMÍNIO.
 *
 * Inclui a etapa paga do Claude (R$ 0,10/empresa) — um clique deliberado sobre uma
 * empresa só, não vale a cerimônia de um diálogo de custo.
 */
export async function dispararDominioEmpresa(empresaId: string): Promise<DispararJobResultado> {
  return postar('/jobs/radar/dominio-empresa', { empresa_id: empresaId }, 'dominio-empresa')
}

/**
 * Headcount de uma empresa (04c §4.3). NÃO tem confirmação de custo porque
 * `organizations/enrich` não consome crédito de revelação — ao contrário de protestos.
 */
export async function dispararFuncionariosEmpresa(empresaId: string): Promise<DispararJobResultado> {
  return postar('/jobs/radar/funcionarios-empresa', { empresa_id: empresaId }, 'funcionarios-empresa')
}

export async function dispararFuncionariosLote(loteId: string): Promise<DispararJobResultado> {
  return postar('/jobs/radar/funcionarios-lote', { lote_id: loteId }, 'funcionarios-lote')
}

/** Backfill retroativo de headcount: relê o payload dos enriquecimentos já pagos. */
export async function dispararBackfillFuncionarios(): Promise<DispararJobResultado> {
  return postar('/jobs/radar/backfill-funcionarios', {}, 'funcionarios-backfill')
}

/** Mensal: calibra nos declarantes e reestima todo mundo, nesta ordem. */
export async function dispararEstimadorMensal(): Promise<DispararJobResultado> {
  return postar('/jobs/radar/estimar-faturamento', {}, 'estimador-calibrar')
}

/** Só reaplica a versão vigente dos coeficientes, sem recalibrar. */
export async function dispararReestimarFaturamento(): Promise<DispararJobResultado> {
  return postar('/jobs/radar/reestimar', {}, 'estimador-estimar')
}

// ─── Antecipação (Prompt 04) ─────────────────────────────────────────────────

/**
 * Sync de NFs (§3). Enqueue-only: o worker pagina o endpoint, parseia XML por
 * nota, reclassifica o funil e regenera a outbox em segundo plano. O caller
 * acompanha por `mercado_ingestoes` (fonte `onepay_nf`).
 */
export async function dispararSyncNfs(): Promise<DispararJobResultado> {
  return postar('/jobs/antecipacao/sync-nfs', { origem: 'cron' }, 'antecipacao-sync-nfs')
}

/**
 * Sync de antecipações + re-matching (04e), sob demanda.
 *
 * No ciclo normal ele roda ENCADEADO ao sync de NFs, e é assim de propósito: o
 * matching precisa das notas novas já na base. Esta rota é o botão "sincronizar
 * agora" e a recuperação de uma corrida que falhou.
 */
export async function dispararSyncAntecipacoes(): Promise<DispararJobResultado> {
  return postar('/jobs/antecipacao/sync-antecipacoes', {}, 'antecipacao-sync-antecipacoes')
}

/**
 * Perfil de Quem Opera (04f): coortes → contrastes → auditoria → sugestões.
 *
 * Enqueue-only. O job varre coortes inteiras e compila as regras de camada para
 * SQL — é trabalho de worker, e o resultado chega em `perfil_snapshots`.
 */
export async function dispararPerfilRecalcular(): Promise<DispararJobResultado> {
  return postar('/jobs/perfil/recalcular', {}, 'perfil-recalcular')
}

/** Calibração da economia com a carteira real (04e §5). Só mede; aplicar é da tela. */
export async function dispararCalibrarEconomia(): Promise<DispararJobResultado> {
  return postar('/jobs/antecipacao/calibrar', {}, 'antecipacao-calibrar')
}

/** O job diário (§9): supressões expiradas → lookup cadastral → reclassificar → outbox. */
export async function dispararAntecipacaoDiario(): Promise<DispararJobResultado> {
  return postar('/jobs/antecipacao/diario', {}, 'antecipacao-diario')
}

/**
 * Reclassificação do funil sob demanda. É o que a ATIVAÇÃO de uma regra de faixa
 * dispara: ativar sem reclassificar deixaria o funil inteiro carregando as faixas
 * que a regra ANTIGA atribuiu — a mesma armadilha da pirâmide (§5.1).
 */
export async function dispararReclassificacaoFunil(): Promise<DispararJobResultado> {
  return postar('/jobs/antecipacao/reclassificar', {}, 'antecipacao-reclassificar')
}

/**
 * Análises de crédito da plataforma (04h): a fonte de quem FOI cliente e saiu.
 * Encadeado ao temperature report no cron diário, e disponível sob demanda porque
 * "este cliente saiu mesmo?" é uma pergunta que não espera até amanhã.
 */
export async function dispararSincronizarAnalisesPlataforma(): Promise<DispararJobResultado> {
  return postar('/jobs/credito/sync-analises-plataforma', {}, 'credito-analises-plataforma')
}

/** Regeneração da outbox — depois de mexer na régua de disparo de uma faixa. */
export async function dispararOutbox(): Promise<DispararJobResultado> {
  return postar('/jobs/antecipacao/outbox', {}, 'antecipacao-outbox')
}

/** Lookup cadastral sob demanda, para esvaziar a fila sem esperar o diário. */
export async function dispararLookupCadastral(): Promise<DispararJobResultado> {
  return postar('/jobs/antecipacao/lookup', {}, 'antecipacao-lookup')
}

/**
 * Protesto de um fornecedor do funil (ação PAGA) + reclassificação, pelo CNPJ. Sem
 * exigir empresa: é justamente o protesto que ajuda a decidir quem vale promover.
 */
export async function dispararProtestoFornecedor(cnpj: string): Promise<DispararJobResultado> {
  return postar('/jobs/antecipacao/protesto-fornecedor', { cnpj }, 'antecipacao-protesto-fornecedor')
}

/**
 * Materializa em `contatos` o que chegou dentro das notas. Sob demanda porque a
 * primeira execução é RETROATIVA: o sync é incremental e nunca rebusca nota
 * antiga, então o contato que chegou antes desta rotina existir só sai do jsonb
 * por aqui.
 */
export async function dispararContatosNf(): Promise<DispararJobResultado> {
  return postar('/jobs/antecipacao/contatos', {}, 'antecipacao-contatos')
}

export interface ReclassificarInput {
  camada: string
  regraId: string
  versao: number
}

/**
 * Activating a camada rule is only half the job: the universe still carries the
 * layers the OLD rule assigned. The worker owns the bulk reclassification (2M rows,
 * a direct pg connection, compileToSql) — this just wakes it up.
 *
 * The promotion threshold is deliberately NOT sent. It used to be pushed in the
 * body, and the worker never read it — it used its own CAMADA_PROMOCAO env var,
 * so an admin who chose "somente manual" in the UI would still watch the next
 * ingestion auto-promote. The worker now reads `app_config` straight from the
 * database (the only owner), and the ingestion path gets the same value the UI
 * shows — which the body param never could, since cron-triggered ingestions have
 * no body from us at all.
 */
export async function dispararReclassificacao(
  input: ReclassificarInput,
): Promise<DispararJobResultado> {
  return postar(
    ROTA_RECLASSIFICAR,
    {
      camada: input.camada,
      regra_id: input.regraId,
      versao: input.versao,
    },
    'reclassificar',
  )
}

// ─── Prévia da regra (§5.1) ─────────────────────────────────────────────────

export type PreverRegraResultado =
  | { ok: true; previsao: PreviaRegra }
  | { ok: false; message: string }

/**
 * A count over the whole universe under RLS times out at 8s in the browser, so the
 * dry-run lives on the worker: it holds a direct pg connection with no statement
 * timeout AND uses compileToSql — the exact compiler the reclassification runs, so
 * the numbers shown here cannot disagree with what applying the rule will do.
 *
 * Unlike dispararJob (which only ENQUEUES and returns in ms), this WAITS for the
 * scan (~a few seconds). The ceiling is generous but still bounds a hung container.
 */
const PREVIEW_TIMEOUT_MS = 30_000

function ehPreviaRegra(x: unknown): x is PreviaRegra {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.camada === 'string' &&
    typeof o.subindo === 'number' &&
    typeof o.descendo === 'number' &&
    typeof o.permanecem === 'number' &&
    typeof o.totalMovidas === 'number' &&
    Array.isArray(o.destinos)
  )
}

export async function preverRegraNoWorker(
  camada: CamadaComRegra,
  definicao: unknown,
): Promise<PreverRegraResultado> {
  const baseUrl = process.env.WORKER_URL
  const secret = process.env.WORKER_SECRET
  if (!baseUrl || !secret) {
    return { ok: false, message: 'O worker do Mercado não está configurado (WORKER_URL / WORKER_SECRET).' }
  }

  let url: string
  try {
    url = new URL('/jobs/preview-regra', baseUrl).toString()
  } catch {
    return { ok: false, message: 'WORKER_URL inválida.' }
  }

  let resposta: Response
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ camada, definicao }),
      cache: 'no-store',
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
    })
  } catch (error) {
    console.error('[mercado] falha de rede na prévia da regra', {
      erro: error instanceof Error ? error.name : 'desconhecido',
    })
    return {
      ok: false,
      message:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'A prévia demorou demais para responder. Tente novamente em instantes.'
          : 'Não foi possível falar com o worker. Verifique se o serviço está no ar.',
    }
  }

  if (!resposta.ok) {
    const corpo = trecho(await resposta.text().catch(() => ''))
    console.error('[mercado] worker recusou a prévia', { status: resposta.status })
    return {
      ok: false,
      message:
        resposta.status === 401 || resposta.status === 403
          ? 'O worker recusou a autenticação. Confira o WORKER_SECRET nos dois lados.'
          : `O worker respondeu ${resposta.status} ao calcular a prévia${corpo ? `: ${corpo}` : '.'}`,
    }
  }

  const corpo: unknown = await resposta.json().catch(() => null)
  if (!ehPreviaRegra(corpo)) {
    return { ok: false, message: 'O worker devolveu uma prévia em formato inesperado.' }
  }
  return { ok: true, previsao: corpo }
}

// ─── Crédito (Prompt 04d) ────────────────────────────────────────────────────

/** Mensal: calibra na carteira, pontua a base e calcula o potencial, nesta ordem. */
export async function dispararCreditoMensal(): Promise<DispararJobResultado> {
  return postar('/jobs/credito/mensal', {}, 'credito-mensal')
}

/** Só os scores (+ potencial, que depende da chance). O que ativar um scorecard dispara. */
export async function dispararRecalcularScores(): Promise<DispararJobResultado> {
  return postar('/jobs/credito/scores', {}, 'credito-scores')
}

/** Só o potencial, reaplicando a versão vigente — depois de mexer em taxa, TAC ou caps. */
export async function dispararEstimarPotencial(): Promise<DispararJobResultado> {
  return postar('/jobs/credito/potencial', {}, 'credito-potencial')
}

/**
 * Envio à seguradora. Ação PAGA e a ÚNICA que resolve buyer novo — por isso recebe ids
 * explícitos, nunca "todas". A confirmação de custo fica no caller (a tela mostra
 * quantas e o que isso significa antes de disparar).
 */
export async function dispararEnviarAnalises(analiseIds: string[]): Promise<DispararJobResultado> {
  return postar('/jobs/credito/enviar', { analise_ids: analiseIds }, 'credito-enviar')
}

export async function dispararPollDecisoes(): Promise<DispararJobResultado> {
  return postar('/jobs/credito/poll', {}, 'credito-poll')
}

/**
 * Backfill do histórico da apólice. Uma vez; não descobre buyer novo.
 *
 * `simular` lê e mapeia tudo sem gravar — é o ensaio, e o único modo permitido fora de
 * produção, porque o backfill real insere no banco o que ler da seguradora.
 */
export async function dispararBackfillAtradius(simular = false): Promise<DispararJobResultado> {
  return postar('/jobs/credito/backfill', { simular }, 'credito-backfill')
}

/** Diário: sync do que já está na apólice + poll + expiração. */
export async function dispararSyncAtradius(): Promise<DispararJobResultado> {
  return postar('/jobs/credito/sync', {}, 'credito-sync')
}

/**
 * Análise proprietária (04j): roda UMA análise do ponto em que ela parou.
 *
 * Chamada duas vezes no caminho de uma análise — depois de abrir (extração) e depois da
 * revisão da extração (cálculo + parecer). É AÇÃO PAGA: cada corrida relê os documentos
 * no modelo, e por isso recebe o id explícito, nunca "todas as pendentes".
 */
export async function dispararAnalisePropria(analiseId: string): Promise<DispararJobResultado> {
  return postar('/jobs/credito/analise-propria', { analise_propria_id: analiseId }, 'credito-analise-propria')
}

/** Rede de segurança: retoma o que ficou em `processando` depois de um deploy. */
export async function dispararDrenarAnalisesProprias(): Promise<DispararJobResultado> {
  return postar('/jobs/credito/analises-drenar', {}, 'credito-analises-drenar')
}

/**
 * Enriquece os leads pendentes do formulário (04i): domínio, faturamento e score sempre;
 * funcionários e Apollo só nos formulários com `enriquecimento_pago`.
 *
 * Sem argumentos de propósito: quem chama não escolhe QUAIS leads, e por isso não pode
 * escolher gastar. A varredura decide a partir do que está pendente no banco.
 */
export async function dispararEnriquecerLeads(): Promise<DispararJobResultado> {
  return postar('/jobs/leads/enriquecer', {}, 'leads-enriquecer')
}

/**
 * A cadeia inteira sobre UMA empresa: domínio → funcionários → faturamento → score.
 *
 * Substitui quatro botões que exigiam da pessoa saber a ordem em que eles dependem uns
 * dos outros. Dado obtido há menos de 30 dias é reaproveitado, não reconsultado.
 */
export async function dispararEnriquecerEmpresa(
  empresaId: string,
  incluirPagos: boolean,
): Promise<DispararJobResultado> {
  return postar(
    '/jobs/radar/enriquecer-empresa',
    { empresa_id: empresaId, incluir_pagos: incluirPagos },
    'enriquecer-empresa',
  )
}

/** Diário: SUGERE reanálise do que vence em 60 dias. Nunca executa em lote. */
export async function dispararSugerirReanalises(): Promise<DispararJobResultado> {
  return postar('/jobs/credito/sugerir-reanalises', {}, 'credito-reanalises')
}

// ─── Jurídico (Prompt 08) ───────────────────────────────────────────────────

/**
 * Descoberta pelos NOSSOS CNPJs. `comMovimentacoes` desligado por padrão: numa
 * importação de trezentos processos, puxar a timeline de cada um é uma varredura
 * paginada paga por processo.
 */
export async function dispararDescobrirProcessos(input: {
  cnpj?: string
  incluirInativos?: boolean
  comMovimentacoes?: boolean
} = {}): Promise<DispararJobResultado> {
  return postar('/jobs/juridico/descobrir', input, 'juridico-descobrir')
}

/**
 * A sincronização. Sem `numeroCnj` é a varredura agendada (e o worker confere a
 * agenda); com, é o botão "Atualizar agora" de um processo, que ignora a agenda de
 * propósito — quem clicou está olhando a tela.
 */
export async function dispararSincronizarJuridico(input: {
  numeroCnj?: string
  forcarAgenda?: boolean
} = {}): Promise<DispararJobResultado> {
  return postar('/jobs/juridico/sincronizar', input, 'juridico-sincronizar')
}

export async function dispararAlertasJuridico(): Promise<DispararJobResultado> {
  return postar('/jobs/juridico/alertas', {}, 'juridico-alertas')
}

export async function dispararCallbacksJuridico(): Promise<DispararJobResultado> {
  return postar('/jobs/juridico/callbacks', {}, 'juridico-callbacks')
}

/** Reclassificar as fases sobre o que já está no banco. Não gasta crédito nenhum. */
export async function dispararClassificarFases(numeroCnj?: string): Promise<DispararJobResultado> {
  return postar('/jobs/juridico/classificar', numeroCnj ? { numeroCnj } : {}, 'juridico-classificar')
}

export async function dispararMonitoramentosJuridico(): Promise<DispararJobResultado> {
  return postar('/jobs/juridico/monitoramentos', {}, 'juridico-monitoramentos')
}

/**
 * O parecer é SÍNCRONO e devolve o corpo, ao contrário de todo o resto desta lista.
 *
 * Quem clicou acabou de autorizar um gasto em tokens e está com a tela aberta; um
 * 202 com id o obrigaria a recarregar até o texto que ele pagou aparecer. O teto de
 * tempo é generoso pela mesma razão do clique de descoberta do 04l: a chamada faz o
 * trabalho, não o enfileira.
 */
export async function dispararParecerJuridico(input: {
  numeroCnj: string
  geradoPor?: string | null
}): Promise<DispararJobResultado> {
  return postar('/jobs/juridico/parecer', input, 'juridico-parecer', 320_000)
}

// ─── Comunicação (05A) ──────────────────────────────────────────────────────
/*
 * Os seis relógios do módulo. Todos enfileiram e devolvem 202 — nenhum deles é
 * um clique que alguém está esperando na tela, e o único que fica perto disso (a
 * fila de envio) já responde em segundos porque o trabalho pesado é o intervalo
 * entre envios, que roda dentro do worker.
 */

export async function dispararEnviarFilaComunicacao(
  input: { limite?: number } = {},
): Promise<DispararJobResultado> {
  return postar('/jobs/comunicacao/enviar-fila', input, 'comunicacao-fila')
}

export async function dispararTriagemComunicacao(
  input: { limite?: number } = {},
): Promise<DispararJobResultado> {
  return postar('/jobs/comunicacao/triagem', input, 'comunicacao-triagem')
}

export async function dispararGmailSync(): Promise<DispararJobResultado> {
  return postar('/jobs/comunicacao/gmail-sync', {}, 'comunicacao-gmail')
}

export async function dispararLembretesReuniao(): Promise<DispararJobResultado> {
  return postar('/jobs/comunicacao/lembretes', {}, 'comunicacao-lembretes')
}

export async function dispararPlantao(): Promise<DispararJobResultado> {
  return postar('/jobs/comunicacao/plantao', {}, 'comunicacao-plantao')
}

export async function dispararAgenteDecidir(
  input: { limite?: number } = {},
): Promise<DispararJobResultado> {
  return postar('/jobs/agente/decidir', input, 'agente-decidir')
}

export async function dispararAgenteAgendados(
  input: { limite?: number } = {},
): Promise<DispararJobResultado> {
  return postar('/jobs/agente/executar-agendados', input, 'agente-agendados')
}

/**
 * O repasse dos webhooks de comunicação para o worker.
 *
 * As URLs cadastradas no painel do Wasender e do Resend podem apontar para a web
 * (que tem domínio estável e certificado) ou para o worker. As duas precisam
 * funcionar, e precisam produzir EXATAMENTE o mesmo efeito — uma segunda
 * implementação do ledger e da fila de identificação divergiria na primeira
 * correção que alguém fizesse em só uma delas.
 *
 * Então a rota da web autentica o provedor com o segredo DELE e repassa o corpo
 * cru para a rota do worker, que autentica com o WORKER_SECRET. Um salto a mais,
 * uma implementação só.
 */
export async function repassarWebhookComunicacao(
  provedor: 'wasender' | 'resend',
  corpo: unknown,
): Promise<DispararJobResultado> {
  return postar(`/webhooks/${provedor}`, corpo, `webhook-${provedor}`)
}

// ─── Campanhas (05B) ────────────────────────────────────────────────────────

/**
 * A simulação é disparada por uma PESSOA que está esperando na tela, mas volta
 * 202 mesmo assim: montar o público de cinco mil empresas passa do timeout de
 * uma requisição. A tela faz polling na campanha até `simulada_em` mudar.
 */
export async function dispararSimularCampanha(campanhaId: string): Promise<DispararJobResultado> {
  return postar('/jobs/campanhas/simular', { campanha_id: campanhaId }, 'campanhas-simular')
}

/** Materializa, enfileira a leva do dia e conclui o que acabou. */
export async function dispararExecutarCampanhas(): Promise<DispararJobResultado> {
  return postar('/jobs/campanhas/executar', {}, 'campanhas-executar')
}

export async function dispararSequenciaCampanhas(): Promise<DispararJobResultado> {
  return postar('/jobs/campanhas/avancar-sequencia', {}, 'campanhas-sequencia')
}

export async function dispararMetricasCampanhas(): Promise<DispararJobResultado> {
  return postar('/jobs/campanhas/metricas', {}, 'campanhas-metricas')
}
