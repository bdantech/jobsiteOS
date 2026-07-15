/**
 * Wire contract for POST /api/ai — shared by the web AI Bar and the mobile AI
 * sheet. Both platforms speak this exact protocol; the mobile app re-implements
 * the client side against these types (copy them, or import from here once the
 * types move to packages/core).
 *
 * Client-safe on purpose: zod only, no server imports.
 */
import { z } from 'zod'

// ─── Conversation history ───────────────────────────────────────────────────
// A deliberately thin mirror of the Anthropic Messages shape. The client keeps
// the transcript and replays it on every request — /api/ai is stateless, which
// is what lets a confirmation round-trip work across two HTTP calls.

export const aiTextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
})

export const aiToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
})

export const aiToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string().min(1),
  content: z.string(),
  is_error: z.boolean().optional(),
})

export const aiContentBlockSchema = z.discriminatedUnion('type', [
  aiTextBlockSchema,
  aiToolUseBlockSchema,
  aiToolResultBlockSchema,
])

export const aiMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.array(aiContentBlockSchema).min(1),
})

export type AiTextBlock = z.infer<typeof aiTextBlockSchema>
export type AiToolUseBlock = z.infer<typeof aiToolUseBlockSchema>
export type AiToolResultBlock = z.infer<typeof aiToolResultBlockSchema>
export type AiContentBlock = z.infer<typeof aiContentBlockSchema>
export type AiMessage = z.infer<typeof aiMessageSchema>

// ─── Request ────────────────────────────────────────────────────────────────

/**
 * Caps exist because the whole transcript is client-supplied: without them a
 * caller could push an arbitrarily large prompt through our Anthropic key.
 */
export const AI_MAX_MESSAGES = 60
export const AI_MAX_CHARS = 60_000

export const aiRequestSchema = z
  .object({
    /** Full transcript. Last entry is a user turn, or the assistant turn awaiting confirmation. */
    messages: z.array(aiMessageSchema).min(1).max(AI_MAX_MESSAGES),
    /** Where the user is right now: a web route ("/empresas/<id>") or a mobile screen name. */
    route: z.string().max(200).optional(),
    /**
     * Only on a resume turn: the user's verdict on each `confirm_required` the
     * previous turn emitted, keyed by tool_use id. Every pending mutating tool
     * of that turn must appear here or the server just asks again.
     */
    decisions: z.record(z.string(), z.boolean()).optional(),
  })
  .refine(
    (body) => JSON.stringify(body.messages).length <= AI_MAX_CHARS,
    { message: 'Conversa longa demais. Comece uma nova conversa.', path: ['messages'] },
  )

export type AiRequest = z.infer<typeof aiRequestSchema>

// ─── Response: SSE events ───────────────────────────────────────────────────
// Frames are `event: <type>\ndata: <json>\n\n`. The `type` field is repeated
// inside the JSON payload so a client can ignore the SSE event name and just
// discriminate on the parsed body.

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

/** The model asked for a tool. Render "🔎 buscando empresas…" from `label`. */
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
  /** Short pt-BR line for the activity row. Never the raw payload. */
  summary: string
  links: AiLink[]
}

/** A mutating tool is staged but NOT executed. Nothing happens until `decisions` says so. */
export interface AiConfirmRequiredEvent {
  type: 'confirm_required'
  id: string
  tool: string
  label: string
  /** Ready-made pt-BR prompt, e.g. "A IA quer criar empresa — confirmar?". */
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

export function encodeAiEvent(event: AiEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}
