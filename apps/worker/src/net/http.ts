import { fetch } from 'undici'
import { logger } from '../logger.js'

/**
 * Cliente HTTP JSON para as APIs do Radar (Apollo, DirectD, Onepay, Anthropic).
 *
 * Generaliza o backoff do download.ts (exponencial × fator, com jitter para não
 * sincronizar retries) sem a parte de disco/Range. Retenta só o que vale a pena:
 * 429 (rate limit) e 5xx. 4xx que não seja 429 é erro do cliente — lança na hora.
 */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly corpo?: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function retryavel(status: number): boolean {
  return status === 429 || status >= 500
}

export interface OpcoesHttp {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  /** Total de tentativas (1 inicial + retries). Default 3. */
  tentativas?: number
  /** Primeiro backoff, em ms. Cresce × fator. Default 2s. */
  baseMs?: number
  fator?: number
  timeoutMs?: number
}

export async function requisitarJson<T = unknown>(url: string, opcoes: OpcoesHttp = {}): Promise<T> {
  const tentativas = opcoes.tentativas ?? 3
  const baseMs = opcoes.baseMs ?? 2000
  const fator = opcoes.fator ?? 3
  let ultimoErro: unknown = null

  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    if (tentativa > 1) {
      const atraso = Math.round(baseMs * fator ** (tentativa - 2) * (0.85 + Math.random() * 0.3))
      logger.warn({ url, tentativa, atraso_ms: atraso }, 'HTTP falhou; aguardando antes do retry.')
      await dormir(atraso)
    }

    try {
      const res = await fetch(url, {
        method: opcoes.method ?? 'GET',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...opcoes.headers },
        body: opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined,
        signal: AbortSignal.timeout(opcoes.timeoutMs ?? 30_000),
      })

      if (!res.ok) {
        const corpo = await res.text().catch(() => '')
        /*
         * O CORPO VAI NA MENSAGEM, e não só no campo ao lado.
         *
         * Quem registra a falha — `falharIngestao`, o outbox, a esteira — grava
         * `erro.message`, e `corpo` ficava para trás. O resultado é a linha que
         * diz "HTTP 500" e mais nada: não dá para distinguir a API do provedor
         * fora do ar de um parâmetro que passamos errado, e as duas coisas se
         * consertam em lugares diferentes.
         *
         * Foi exatamente o que custou caro no envio à seguradora, e de novo nas
         * treze falhas seguidas do sync de antecipações. 300 caracteres bastam
         * para o começo de um JSON de erro e evitam despejar uma página de HTML
         * de gateway no banco.
         */
        const trecho = corpo.trim().replace(/\s+/g, ' ').slice(0, 300)
        const erro = new HttpError(
          trecho ? `HTTP ${res.status}: ${trecho}` : `HTTP ${res.status}`,
          res.status,
          corpo,
        )
        if (!retryavel(res.status)) throw erro // 4xx (≠429): não retenta
        ultimoErro = erro
        logger.error({ url, tentativa, status: res.status }, 'HTTP retryável.')
        continue
      }

      // 204/sem corpo → objeto vazio.
      const texto = await res.text()
      return (texto ? JSON.parse(texto) : {}) as T
    } catch (erro) {
      // Erro de cliente (4xx≠429) sobe direto; rede/timeout/5xx entram no retry.
      if (erro instanceof HttpError && !retryavel(erro.status)) throw erro
      ultimoErro = erro
      logger.error({ url, tentativa, erro: String(erro) }, 'HTTP erro (rede/timeout).')
    }
  }

  throw ultimoErro instanceof Error
    ? ultimoErro
    : new Error(`HTTP falhou após ${tentativas} tentativas: ${String(ultimoErro)}`)
}

/**
 * Espaçador simples de requisições: garante ao menos `intervaloMs` entre chamadas.
 * O throttle do codebase é sequencial (for...await) + este pacer — sem lib.
 * Uso: `const pace = criarPacer(250); for (...) { await pace(); await requisitar(...) }`.
 */
export function criarPacer(intervaloMs: number): () => Promise<void> {
  let ultimo = 0
  return async () => {
    const espera = ultimo + intervaloMs - Date.now()
    if (espera > 0) await dormir(espera)
    ultimo = Date.now()
  }
}
