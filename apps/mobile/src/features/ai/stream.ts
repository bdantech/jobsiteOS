import { API_BASE_URL } from '@/lib/api'
import { supabase } from '@/lib/supabase'

import type { AiEvent, AiRequest } from './protocol'
import { SseParser } from './sse-parser'

/**
 * SSE client for POST /api/ai.
 *
 * ── Why XMLHttpRequest and not fetch ─────────────────────────────────────────
 * React Native's `fetch` is the whatwg-fetch polyfill riding on XHR: it has no
 * `response.body`, so `getReader()` is undefined and awaiting `response.text()`
 * buffers the ENTIRE turn before the first token can be painted. An AI answer
 * that takes 12s to generate would appear all at once at t=12s. That is exactly
 * the failure mode this endpoint exists to avoid.
 *
 * `expo/fetch` (SDK 52) does expose a real streaming body, but it is a distinct
 * networking stack from RN's, and on the paths that matter here it is still the
 * newer, less-exercised one. RN's XHR, by contrast, has a documented incremental
 * mode — the same one every RN SSE library is built on — that works on Hermes,
 * iOS and Android alike. We take the boring, universally-supported path:
 *
 *   RCTNetworking pushes partial bodies to JS ONLY when incremental updates are
 *   on, and XMLHttpRequest turns them on iff `responseType` is '' | 'text' AND a
 *   readystatechange/progress handler is attached AT send() TIME. Both handlers
 *   below are therefore assigned before send(), and responseType is left as
 *   'text'. Get either wrong and the request still succeeds — it just buffers,
 *   which is why this is spelled out rather than left to be rediscovered.
 *
 * `responseText` accumulates, so we slice from a cursor and keep a tail buffer
 * for the frame that is split across two chunks.
 */

export class AiStreamError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'AiStreamError'
    this.status = status
  }
}

/** The user pressed stop, or the sheet unmounted. Not a failure — never shown as one. */
export class AiStreamAbort extends Error {
  constructor() {
    super('Requisição cancelada.')
    this.name = 'AiStreamAbort'
  }
}

export function isAiStreamAbort(error: unknown): error is AiStreamAbort {
  return error instanceof AiStreamAbort
}

export interface StreamAiTurnOptions {
  body: AiRequest
  signal: AbortSignal
  /**
   * Called once per network chunk with every event it contained — not once per
   * event. One chunk routinely carries several text deltas, and batching them
   * into a single setState keeps the transcript at one re-render per chunk
   * instead of one per token.
   */
  onEvents: (events: AiEvent[]) => void
}

const XHR_LOADING = 3

function errorMessageFrom(rawBody: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (typeof parsed === 'object' && parsed !== null) {
      const error = (parsed as { error?: unknown }).error
      if (typeof error === 'string' && error.length > 0) return error
    }
  } catch {
    // Not JSON: a proxy/CDN error page. Fall through to the generic copy.
  }

  if (status === 401) return 'Sua sessão expirou. Entre novamente.'
  if (status === 429) return 'Muitas requisições. Aguarde um instante e tente de novo.'
  if (status >= 500) return 'O servidor da IA falhou. Tente novamente em instantes.'
  return `Falha na IA (${status}).`
}

export async function streamAiTurn({ body, signal, onEvents }: StreamAiTurnOptions): Promise<void> {
  // getSession() refreshes an expired JWT before handing it over — same contract
  // as lib/api.ts. Expo has no cookie jar: this header IS the session.
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new AiStreamError('Sua sessão expirou. Entre novamente.', 401)

  if (signal.aborted) throw new AiStreamAbort()

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const parser = new SseParser()
    let cursor = 0
    let settled = false

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
    }

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    function onAbort() {
      finish(() => {
        xhr.abort()
        reject(new AiStreamAbort())
      })
    }

    /** Drains whatever arrived since the last call. Never re-reads what it read. */
    const drain = (): void => {
      // Only the 2xx body is an SSE stream; an error body is JSON and is read in
      // full at DONE. Reading responseText before HEADERS_RECEIVED is also unsafe.
      if (xhr.status !== 200) return

      const text = xhr.responseText
      if (text.length <= cursor) return

      const chunk = text.slice(cursor)
      cursor = text.length

      const events = parser.push(chunk)
      if (events.length > 0) onEvents(events)
    }

    xhr.open('POST', `${API_BASE_URL}/api/ai`)
    xhr.responseType = 'text'
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Accept', 'text/event-stream')
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    // Kills any proxy-level response buffering that would otherwise defeat the
    // whole point of streaming (nginx honours this; Vercel already streams).
    xhr.setRequestHeader('X-Accel-Buffering', 'no')

    // ASSIGNED BEFORE send(): this is what switches RN into incremental mode.
    xhr.onreadystatechange = () => {
      if (settled) return
      if (xhr.readyState === XHR_LOADING) drain()
    }
    xhr.onprogress = () => {
      if (!settled) drain()
    }

    xhr.onload = () => {
      finish(() => {
        if (xhr.status !== 200) {
          reject(new AiStreamError(errorMessageFrom(xhr.responseText, xhr.status), xhr.status))
          return
        }

        // readystatechange for DONE may carry the tail in one go.
        const text = xhr.responseText
        if (text.length > cursor) {
          const events = parser.push(text.slice(cursor))
          cursor = text.length
          if (events.length > 0) onEvents(events)
        }

        const tail = parser.flush()
        if (tail.length > 0) onEvents(tail)

        resolve()
      })
    }

    xhr.onerror = () => {
      finish(() =>
        reject(new AiStreamError('Sem conexão com o servidor. Verifique sua internet.')),
      )
    }
    xhr.ontimeout = () => {
      finish(() => reject(new AiStreamError('A IA demorou demais para responder.')))
    }
    xhr.onabort = () => {
      finish(() => reject(new AiStreamAbort()))
    }

    signal.addEventListener('abort', onAbort)

    // No timeout: a tool-calling turn legitimately runs for tens of seconds, and
    // XHR's timeout is wall-clock over the whole request, not an idle timeout —
    // it would kill healthy long answers mid-stream.
    xhr.timeout = 0
    xhr.send(JSON.stringify(body))

    // An abort that landed between the guard at the top of the function and the
    // listener registration above would otherwise be lost.
    if (signal.aborted) onAbort()
  })
}
