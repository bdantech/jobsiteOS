import { fetch } from 'undici'
import {
  creditosDoHeader,
  varrerCursor,
  type EscavadorMovimentacao,
  type EscavadorProcesso,
} from '../../../../packages/core/src/juridico/escavador.js'
import type { TipoSync } from '../../../../packages/core/src/juridico/schemas.js'
import { supabaseAdmin } from '../db.js'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { criarPacer } from '../net/http.js'

/**
 * Cliente do Escavador (API v2) — 08 §3.
 *
 * ── POR QUE NÃO USA `requisitarJson` ────────────────────────────────────────
 * O helper genérico do worker devolve só o corpo, e aqui o HEADER é metade da
 * informação: `Creditos-Utilizados` diz quanto aquela chamada custou, e é a ÚNICA
 * fonte desse número — a API não tem extrato consultável. Sem ler o header, o custo
 * do módulo só apareceria na fatura, um mês depois de alguém ter ligado a
 * atualização forçada no tribunal para trezentos processos.
 *
 * ── O THROTTLE É DE 500/min E NÃO É NEGOCIÁVEL ──────────────────────────────
 * Estourar o limite devolve 429, e um 429 no meio de uma varredura por cursor
 * perde a página — não a requisição. O pacer de 130 ms garante ~460/min com folga
 * para o jitter do retry, que é onde a conta estoura de verdade: o retry de uma
 * chamada acontece DENTRO da janela do minuto que já estava cheio.
 */

const BASE = 'https://api.escavador.com/api/v2'

/** ~460 req/min, com folga para os retries caberem na mesma janela. */
const pace = criarPacer(130)

export class EscavadorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly corpo?: string,
  ) {
    super(message)
    this.name = 'EscavadorError'
  }
}

export interface RespostaEscavador<T> {
  dados: T
  creditos: number
}

interface OpcoesChamada {
  method?: string
  body?: unknown
  /** Grava a linha em `juridico_sync_log`. Omitir só em chamadas de diagnóstico. */
  log?: { tipo: TipoSync; numero_cnj?: string | null; cnpj?: string | null }
  tentativas?: number
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * A ÚNICA função que fala HTTP com o Escavador.
 *
 * Um caminho só para o token, para o throttle e para a contabilização — o token
 * nunca é logado, nunca entra numa mensagem de erro e nunca sobe para a UI.
 */
export async function chamar<T>(
  caminhoOuUrl: string,
  opcoes: OpcoesChamada = {},
): Promise<RespostaEscavador<T>> {
  if (!env.ESCAVADOR_TOKEN) {
    throw new EscavadorError('ESCAVADOR_TOKEN não configurado no worker.', 0)
  }

  // `links.next` volta como URL absoluta; os chamadores passam caminho relativo.
  const url = caminhoOuUrl.startsWith('http') ? caminhoOuUrl : `${BASE}${caminhoOuUrl}`
  const tentativas = opcoes.tentativas ?? 3
  let ultimoErro: unknown = null

  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    if (tentativa > 1) await dormir(Math.round(2000 * 3 ** (tentativa - 2) * (0.85 + Math.random() * 0.3)))
    await pace()

    try {
      const res = await fetch(url, {
        method: opcoes.method ?? 'GET',
        headers: {
          authorization: `Bearer ${env.ESCAVADOR_TOKEN}`,
          // Exigido pela API v2: sem ele a resposta vem em HTML, não em JSON.
          'X-Requested-With': 'XMLHttpRequest',
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined,
        signal: AbortSignal.timeout(60_000),
      })

      const creditos = creditosDoHeader(res.headers)

      if (!res.ok) {
        const corpo = await res.text().catch(() => '')
        const erro = new EscavadorError(`Escavador HTTP ${res.status}`, res.status, corpo.slice(0, 300))
        // 4xx que não seja 429 é erro nosso (CNJ inválido, token sem permissão):
        // retentar só gasta a janela do rate limit sem mudar a resposta.
        if (res.status !== 429 && res.status < 500) {
          await registrar(opcoes.log, 'erro', creditos, erro.message)
          throw erro
        }
        ultimoErro = erro
        logger.warn({ url, tentativa, status: res.status }, 'Escavador retryável.')
        continue
      }

      const texto = await res.text()
      await registrar(opcoes.log, 'ok', creditos, null)
      return { dados: (texto ? JSON.parse(texto) : {}) as T, creditos }
    } catch (erro) {
      if (erro instanceof EscavadorError && erro.status !== 429 && erro.status < 500 && erro.status > 0) {
        throw erro
      }
      ultimoErro = erro
      logger.error({ url, tentativa, erro: String(erro) }, 'Escavador falhou (rede/timeout).')
    }
  }

  const msg = ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro)
  await registrar(opcoes.log, 'erro', 0, msg)
  throw ultimoErro instanceof Error ? ultimoErro : new Error(msg)
}

/**
 * A linha do log NUNCA derruba a chamada.
 *
 * O log existe para contar o gasto, e perder uma linha dele é perder um número.
 * Perder a sincronização de um processo porque a contabilidade falhou é perder o
 * trabalho — a ordem de importância é essa, e por isso o catch engole.
 */
async function registrar(
  log: OpcoesChamada['log'],
  status: string,
  creditos: number,
  erro: string | null,
): Promise<void> {
  if (!log) return
  try {
    await supabaseAdmin.from('juridico_sync_log').insert({
      tipo: log.tipo,
      numero_cnj: log.numero_cnj ?? null,
      cnpj: log.cnpj ?? null,
      status,
      creditos_utilizados: creditos,
      erro,
    })
  } catch (e) {
    logger.error({ erro: String(e) }, 'Falha ao gravar juridico_sync_log.')
  }
}

// ─── Paginação por cursor ───────────────────────────────────────────────────

/**
 * Varre TODAS as páginas de um endpoint paginado por cursor.
 *
 * O LAÇO mora em `packages/core` (`varrerCursor`), com testes: as duas defesas que
 * ele carrega — cursor repetido e teto de páginas — são justamente o que separa uma
 * varredura completa de uma fatura, e testá-las aqui exigiria uma rede falsa. Esta
 * função é só a costura com o cliente HTTP.
 */
export async function todasAsPaginasCursor<T>(
  caminhoInicial: string,
  extrair: (pagina: unknown) => T[],
  log: OpcoesChamada['log'],
  maxPaginas = 200,
): Promise<{ itens: T[]; creditos: number; truncado: boolean }> {
  const r = await varrerCursor<T>(
    caminhoInicial,
    (url) => chamar<unknown>(url, { log }),
    extrair,
    maxPaginas,
  )
  if (r.truncado) {
    logger.warn(
      { url: caminhoInicial, paginas: r.paginas },
      'Varredura por cursor interrompida (cursor repetido ou teto de páginas). A lista está incompleta.',
    )
  }
  return { itens: r.itens, creditos: r.creditos, truncado: r.truncado }
}

// ─── Os endpoints usados (§3) ───────────────────────────────────────────────

/** Barato: quantos processos existem para este CNPJ. Roda ANTES de varrer. */
export async function resumoEnvolvido(cnpj: string): Promise<{ quantidade: number; creditos: number }> {
  const r = await chamar<{ quantidade_processos?: number; total?: number }>(
    `/envolvido/resumo?cpf_cnpj=${encodeURIComponent(cnpj)}`,
    { log: { tipo: 'busca_cnpj', cnpj } },
  )
  return { quantidade: r.dados.quantidade_processos ?? r.dados.total ?? 0, creditos: r.creditos }
}

export interface OpcoesDescoberta {
  /** `ATIVO` corta os arquivados na origem — menos página, menos crédito. */
  status?: 'ATIVO' | 'INATIVO'
  data_minima?: string
  limit?: number
}

export async function processosDoEnvolvido(
  cnpj: string,
  opcoes: OpcoesDescoberta = {},
): Promise<{ processos: EscavadorProcesso[]; creditos: number; truncado: boolean }> {
  const params = new URLSearchParams({ cpf_cnpj: cnpj, limit: String(opcoes.limit ?? 100) })
  if (opcoes.status) params.set('status', opcoes.status)
  if (opcoes.data_minima) params.set('data_minima', opcoes.data_minima)

  const r = await todasAsPaginasCursor<EscavadorProcesso>(
    `/envolvido/processos?${params.toString()}`,
    (p) => ((p as { items?: EscavadorProcesso[] }).items ?? []),
    { tipo: 'busca_cnpj', cnpj },
  )
  return { processos: r.itens, creditos: r.creditos, truncado: r.truncado }
}

export async function capaDoProcesso(
  numeroCnj: string,
): Promise<{ processo: EscavadorProcesso | null; creditos: number }> {
  const r = await chamar<EscavadorProcesso>(`/processos/numero_cnj/${encodeURIComponent(numeroCnj)}`, {
    log: { tipo: 'atualizacao_processo', numero_cnj: numeroCnj },
  })
  return { processo: r.dados ?? null, creditos: r.creditos }
}

export async function movimentacoesDoProcesso(
  numeroCnj: string,
): Promise<{ movimentacoes: EscavadorMovimentacao[]; creditos: number; truncado: boolean }> {
  const r = await todasAsPaginasCursor<EscavadorMovimentacao>(
    `/processos/numero_cnj/${encodeURIComponent(numeroCnj)}/movimentacoes`,
    (p) => ((p as { items?: EscavadorMovimentacao[] }).items ?? []),
    { tipo: 'atualizacao_processo', numero_cnj: numeroCnj },
  )
  return { movimentacoes: r.itens, creditos: r.creditos, truncado: r.truncado }
}

/**
 * Manda o robô ao TRIBUNAL. Custa crédito por chamada e é assíncrono: a resposta
 * chega pelo callback `atualizacao_processo_concluida`.
 */
export async function solicitarAtualizacao(numeroCnj: string): Promise<{ creditos: number }> {
  const r = await chamar<unknown>(
    `/processos/numero_cnj/${encodeURIComponent(numeroCnj)}/solicitar-atualizacao`,
    {
      method: 'POST',
      body: { enviar_callback: 1 },
      log: { tipo: 'atualizacao_processo', numero_cnj: numeroCnj },
    },
  )
  return { creditos: r.creditos }
}

export async function statusAtualizacao(
  numeroCnj: string,
): Promise<{ status: string | null; creditos: number }> {
  const r = await chamar<{ status?: string }>(
    `/processos/numero_cnj/${encodeURIComponent(numeroCnj)}/status-atualizacao`,
    { log: { tipo: 'atualizacao_processo', numero_cnj: numeroCnj } },
  )
  return { status: r.dados.status ?? null, creditos: r.creditos }
}

/** Um monitoramento por entidade nossa: o Escavador avisa quando surgir ação nova. */
export async function criarMonitoramentoNovosProcessos(
  termo: string,
): Promise<{ id: number | null; creditos: number }> {
  const r = await chamar<{ id?: number }>('/monitoramentos/novos-processos', {
    method: 'POST',
    body: { termo },
    log: { tipo: 'monitoramento', cnpj: termo.replace(/\D/g, '') || null },
  })
  return { id: r.dados.id ?? null, creditos: r.creditos }
}

export async function listarMonitoramentos(): Promise<{
  monitoramentos: Array<{ id?: number; termo?: string }>
  creditos: number
}> {
  const r = await chamar<{ items?: Array<{ id?: number; termo?: string }> }>(
    '/monitoramentos/novos-processos',
    { log: { tipo: 'monitoramento' } },
  )
  return { monitoramentos: r.dados.items ?? [], creditos: r.creditos }
}

export async function removerMonitoramento(id: number): Promise<{ creditos: number }> {
  const r = await chamar<unknown>(`/monitoramentos/novos-processos/${id}`, {
    method: 'DELETE',
    log: { tipo: 'monitoramento' },
  })
  return { creditos: r.creditos }
}

/** Popula o filtro de tribunais da UI. Barato e estático — cacheado em config. */
export async function tribunais(): Promise<{
  tribunais: Array<{ id?: number; nome?: string; sigla?: string }>
  creditos: number
}> {
  const r = await chamar<{ items?: Array<{ id?: number; nome?: string; sigla?: string }> }>('/tribunais')
  return { tribunais: r.dados.items ?? [], creditos: r.creditos }
}
