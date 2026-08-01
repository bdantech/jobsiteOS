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
  | { ok: true; ingestaoId: string | null }
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
  return { ok: true, ingestaoId: ingestaoIdDe(corpo) }
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
 * Radar (§5): protestos sob demanda de uma empresa (+ SPEs do grupo criadas a partir de
 * um ano). Ação PAGA — a autorização e a confirmação de custo ficam no caller (a aba
 * Análise financeira mostra a estimativa antes de disparar).
 */
export async function dispararProtestosEmpresa(input: {
  empresaId: string
  incluirSpes: boolean
  anoMin: number | null
}): Promise<DispararJobResultado> {
  return postar(
    '/jobs/radar/protestos-empresa',
    { empresa_id: input.empresaId, incluir_spes: input.incluirSpes, ano_min: input.anoMin },
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

/** Backfill do histórico da apólice. Uma vez; não descobre buyer novo. */
export async function dispararBackfillAtradius(): Promise<DispararJobResultado> {
  return postar('/jobs/credito/backfill', {}, 'credito-backfill')
}

/** Diário: sync do que já está na apólice + poll + expiração. */
export async function dispararSyncAtradius(): Promise<DispararJobResultado> {
  return postar('/jobs/credito/sync', {}, 'credito-sync')
}
