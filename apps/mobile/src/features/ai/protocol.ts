/**
 * Client side of the POST /api/ai wire contract.
 *
 * The SOURCE OF TRUTH is apps/web/src/lib/ai/protocol.ts. These types are a
 * hand-copy of it — exactly what that file's header instructs mobile to do,
 * because the Expo app cannot import from the Next.js app (no dependency edge,
 * and `server-only` siblings would follow it into the bundle). If the wire
 * contract ever moves to packages/core, delete this file and import from there.
 *
 * The runtime guards below exist because everything that arrives on the socket is
 * `unknown` until proven otherwise: a truncated frame, a proxy's error page or an
 * older/newer server must degrade to "ignore this event", never to a crash inside
 * the render tree.
 */

// ─── Conversation history ───────────────────────────────────────────────────
// A thin mirror of the Anthropic Messages shape. The CLIENT owns the transcript
// and replays it on every request — /api/ai is stateless, which is exactly what
// lets a confirmation round-trip work across two HTTP calls.

export interface AiTextBlock {
  type: 'text'
  text: string
}

export interface AiToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export interface AiToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type AiContentBlock = AiTextBlock | AiToolUseBlock | AiToolResultBlock

export interface AiMessage {
  role: 'user' | 'assistant'
  content: AiContentBlock[]
}

// ─── Request ────────────────────────────────────────────────────────────────

export interface AiRequest {
  /** Full transcript. Last entry is a user turn, or the assistant turn awaiting confirmation. */
  messages: AiMessage[]
  /** Where the user is right now — the mobile pathname doubles as the web route. */
  route?: string
  /** Only on a resume turn: the user's verdict per tool_use id. */
  decisions?: Record<string, boolean>
}

// ─── Response: SSE events ───────────────────────────────────────────────────
// Frames are `event: <type>\ndata: <json>\n\n`. The `type` is repeated inside the
// JSON payload, so we discriminate on the parsed body and ignore the event name.

/** A record the model surfaced that the UI can navigate to (empresas.search sets `route`). */
export interface AiLink {
  route: string
  label: string
}

/** One field of a mutating tool's input, pre-formatted for the confirmation card. */
export interface AiConfirmField {
  label: string
  value: string
}

export interface AiTextEvent {
  type: 'text'
  delta: string
}

export interface AiToolStartEvent {
  type: 'tool_start'
  id: string
  tool: string
  label: string
  mutates: boolean
}

export interface AiToolResultEvent {
  type: 'tool_result'
  id: string
  tool: string
  label: string
  ok: boolean
  summary: string
  links: AiLink[]
}

/** A mutating tool is staged but NOT executed. Nothing runs until `decisions` says so. */
export interface AiConfirmRequiredEvent {
  type: 'confirm_required'
  id: string
  tool: string
  label: string
  question: string
  fields: AiConfirmField[]
}

/** Server-authoritative transcript growth. Append verbatim; replay it next turn. */
export interface AiMessageEvent {
  type: 'message'
  message: AiMessage
}

export type AiStopReason = 'end_turn' | 'awaiting_confirmation' | 'max_rounds'

export interface AiDoneEvent {
  type: 'done'
  stop: AiStopReason
}

export interface AiErrorEvent {
  type: 'error'
  message: string
}

export type AiEvent =
  | AiTextEvent
  | AiToolStartEvent
  | AiToolResultEvent
  | AiConfirmRequiredEvent
  | AiMessageEvent
  | AiDoneEvent
  | AiErrorEvent

// ─── Runtime guards ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function parseLinks(value: unknown): AiLink[] {
  if (!Array.isArray(value)) return []

  const links: AiLink[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const route = asString(raw.route)
    const label = asString(raw.label)
    if (route && label) links.push({ route, label })
  }
  return links
}

function parseFields(value: unknown): AiConfirmField[] {
  if (!Array.isArray(value)) return []

  const fields: AiConfirmField[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const label = asString(raw.label)
    const fieldValue = asString(raw.value)
    if (label !== null && fieldValue !== null) fields.push({ label, value: fieldValue })
  }
  return fields
}

function parseContentBlock(raw: unknown): AiContentBlock | null {
  if (!isRecord(raw)) return null

  switch (raw.type) {
    case 'text': {
      const text = asString(raw.text)
      return text === null ? null : { type: 'text', text }
    }
    case 'tool_use': {
      const id = asString(raw.id)
      const name = asString(raw.name)
      if (!id || !name) return null
      return { type: 'tool_use', id, name, input: raw.input }
    }
    case 'tool_result': {
      const toolUseId = asString(raw.tool_use_id)
      const content = asString(raw.content)
      if (!toolUseId || content === null) return null
      const block: AiToolResultBlock = { type: 'tool_result', tool_use_id: toolUseId, content }
      if (typeof raw.is_error === 'boolean') block.is_error = raw.is_error
      return block
    }
    default:
      return null
  }
}

/**
 * Validated hard, because this is the one payload we hand straight back to the
 * server (and thus to Anthropic) on the next turn. A malformed block replayed
 * into the Messages API is a 400 for every subsequent turn of the conversation.
 */
function parseMessage(raw: unknown): AiMessage | null {
  if (!isRecord(raw)) return null
  if (raw.role !== 'user' && raw.role !== 'assistant') return null
  if (!Array.isArray(raw.content)) return null

  const content: AiContentBlock[] = []
  for (const rawBlock of raw.content) {
    const block = parseContentBlock(rawBlock)
    if (!block) return null // partial content would corrupt the replay — drop the whole message
    content.push(block)
  }

  if (content.length === 0) return null
  return { role: raw.role, content }
}

function isStopReason(value: unknown): value is AiStopReason {
  return value === 'end_turn' || value === 'awaiting_confirmation' || value === 'max_rounds'
}

/** One parsed SSE payload → a typed event, or null when we can't trust it. */
export function parseAiEvent(raw: unknown): AiEvent | null {
  if (!isRecord(raw)) return null

  switch (raw.type) {
    case 'text': {
      const delta = asString(raw.delta)
      return delta === null ? null : { type: 'text', delta }
    }

    case 'tool_start': {
      const id = asString(raw.id)
      const tool = asString(raw.tool)
      if (!id || !tool) return null
      return {
        type: 'tool_start',
        id,
        tool,
        label: asString(raw.label) ?? tool,
        mutates: asBoolean(raw.mutates, false),
      }
    }

    case 'tool_result': {
      const id = asString(raw.id)
      const tool = asString(raw.tool)
      if (!id || !tool) return null
      return {
        type: 'tool_result',
        id,
        tool,
        label: asString(raw.label) ?? tool,
        // An unreadable `ok` must not read as success.
        ok: asBoolean(raw.ok, false),
        summary: asString(raw.summary) ?? '',
        links: parseLinks(raw.links),
      }
    }

    case 'confirm_required': {
      const id = asString(raw.id)
      const tool = asString(raw.tool)
      if (!id || !tool) return null
      const label = asString(raw.label) ?? tool
      return {
        type: 'confirm_required',
        id,
        tool,
        label,
        question: asString(raw.question) ?? `A IA quer executar "${label}" — confirmar?`,
        fields: parseFields(raw.fields),
      }
    }

    case 'message': {
      const message = parseMessage(raw.message)
      return message === null ? null : { type: 'message', message }
    }

    case 'done':
      return { type: 'done', stop: isStopReason(raw.stop) ? raw.stop : 'end_turn' }

    case 'error':
      return { type: 'error', message: asString(raw.message) ?? 'Falha na IA. Tente novamente.' }

    default:
      return null
  }
}

// ─── Transcript invariants ──────────────────────────────────────────────────

/**
 * tool_use ids in the final assistant turn that have no tool_result after them.
 *
 * Non-empty means the transcript is NOT replayable: the Messages API rejects a
 * dangling tool_use, and it also rejects two user turns in a row — so we can
 * neither send it as-is nor "fix" it by dropping the assistant turn. The only
 * valid moves are to answer the tool (decide the confirmation) or to close it
 * out with `interruptedResultsTurn()`.
 */
export function danglingToolUseIds(messages: readonly AiMessage[]): string[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return []

  return last.content
    .filter((block): block is AiToolUseBlock => block.type === 'tool_use')
    .map((block) => block.id)
}

const INTERRUPTED =
  'A execução foi interrompida antes de terminar. Não é possível afirmar se a ação foi concluída ou não — verifique com o usuário antes de tentar de novo.'

/**
 * Closes out dangling tool_uses after a connection drop or a user-pressed stop.
 *
 * The wording is deliberately "we don't know" rather than "it failed": the
 * request may have reached the server and the mutation may have run. Telling the
 * model it failed would invite it to helpfully retry a write we never saw the
 * result of. This makes the transcript replayable again without executing
 * anything, and without asserting something we can't know.
 */
export function interruptedResultsTurn(ids: readonly string[]): AiMessage {
  return {
    role: 'user',
    content: ids.map((id) => ({
      type: 'tool_result' as const,
      tool_use_id: id,
      content: INTERRUPTED,
      is_error: true,
    })),
  }
}
