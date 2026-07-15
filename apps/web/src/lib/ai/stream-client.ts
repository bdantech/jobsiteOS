import type { AiEvent, AiMessage } from './protocol'

export interface AiStreamRequest {
  messages: AiMessage[]
  route?: string
  decisions?: Record<string, boolean>
  signal?: AbortSignal
  /** Mobile passes the Supabase access token here; web relies on the cookie. */
  accessToken?: string
}

/**
 * Client half of the /api/ai protocol: POSTs a turn and yields protocol events
 * as they arrive. Deliberately transport-only and framework-free — the mobile
 * app can use this exact function with `accessToken` set.
 *
 * We parse SSE by hand rather than using EventSource because EventSource cannot
 * issue a POST (and cannot send an Authorization header).
 */
export async function* streamAiTurn(request: AiStreamRequest): AsyncGenerator<AiEvent> {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(request.accessToken ? { Authorization: `Bearer ${request.accessToken}` } : {}),
    },
    body: JSON.stringify({
      messages: request.messages,
      route: request.route,
      decisions: request.decisions,
    }),
    signal: request.signal,
  })

  if (!response.ok || !response.body) {
    // Errors before the stream opens come back as JSON, not as an SSE frame.
    let message = 'Falha ao falar com a IA. Tente novamente.'
    try {
      const payload: unknown = await response.json()
      if (payload && typeof payload === 'object' && 'error' in payload) {
        const value = (payload as { error: unknown }).error
        if (typeof value === 'string') message = value
      }
    } catch {
      // Body wasn't JSON — keep the generic message.
    }
    yield { type: 'error', message }
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Frames are separated by a blank line. A partial frame stays in the
      // buffer until the rest of it arrives — chunk boundaries are not frame
      // boundaries.
      let separator = buffer.indexOf('\n\n')
      while (separator !== -1) {
        const frame = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        const event = parseFrame(frame)
        if (event) yield event
        separator = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.cancel().catch(() => {
      // Already closed (abort, navigation). Nothing to do.
    })
  }
}

function parseFrame(frame: string): AiEvent | null {
  // The `event:` line is redundant with the payload's own `type` — we read the
  // data line only, so an unknown event name can never desync the parser.
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('')

  if (!data) return null

  try {
    return JSON.parse(data) as AiEvent
  } catch {
    return null
  }
}
