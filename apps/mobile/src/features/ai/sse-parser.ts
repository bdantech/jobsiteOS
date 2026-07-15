import { parseAiEvent, type AiEvent } from './protocol'

/**
 * Splits an SSE byte stream into frames and yields the events they carry.
 *
 * Pure and transport-agnostic on purpose: the network layer (stream.ts) hands it
 * whatever arbitrary slice of bytes the OS happened to deliver, and every hard
 * case here is a boundary case — a frame split across two chunks, a \r\n torn in
 * half, a heartbeat comment, a half-written JSON payload. Keeping it free of RN
 * imports is what makes those cases directly testable.
 */
export class SseParser {
  private buffer = ''

  /** Feed the bytes that arrived since the last call. */
  push(chunk: string): AiEvent[] {
    // Normalise CRLF on the whole buffer rather than per-frame: a \r\n straddling
    // two chunks then simply resolves on the next push, because the lone \r stays
    // in the buffer.
    this.buffer = `${this.buffer}${chunk}`.replace(/\r\n/g, '\n')

    const frames = this.buffer.split('\n\n')
    // The last element is either '' (the stream ended on a frame boundary) or a
    // partial frame still in flight. Either way it is not ours to parse yet.
    this.buffer = frames.pop() ?? ''

    return frames.flatMap((frame) => this.parseFrame(frame))
  }

  /** At end-of-stream a final frame may be sitting in the buffer without its terminator. */
  flush(): AiEvent[] {
    const rest = this.buffer
    this.buffer = ''
    return rest.trim().length > 0 ? this.parseFrame(rest) : []
  }

  private parseFrame(frame: string): AiEvent[] {
    const data: string[] = []

    for (const line of frame.split('\n')) {
      // ':' opens a comment (heartbeats). 'event:' names the frame, which we
      // ignore on purpose — the type is repeated inside the JSON payload.
      if (line.startsWith(':') || !line.startsWith('data:')) continue
      data.push(line.slice('data:'.length).replace(/^ /, ''))
    }

    if (data.length === 0) return []

    try {
      const event = parseAiEvent(JSON.parse(data.join('\n')))
      return event ? [event] : []
    } catch {
      return [] // Unparseable payload: skip the frame, keep the stream alive.
    }
  }
}
