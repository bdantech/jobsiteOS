import type { AiConfirmField, AiEvent, AiLink } from './protocol'

/**
 * The render model of the chat, and the pure (state, event) → state function that
 * builds it from the SSE stream.
 *
 * This is deliberately NOT the wire transcript. The transcript (owned by
 * use-ai-chat) is server-authoritative, must stay valid for the Anthropic
 * Messages API, and is replayed on every request. These items are free to hold
 * what the wire format has no place for: a half-streamed sentence, a cancelled
 * tool, an error row. Conflating the two is the bug this split exists to prevent.
 *
 * Pure and React-free so the streaming semantics — above all the confirmation
 * round-trip — can be exercised directly.
 */

export type ToolItemState = 'running' | 'awaiting' | 'ok' | 'error'

export type ChatItem =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'assistant'; key: string; text: string }
  | {
      kind: 'tool'
      key: string
      id: string
      tool: string
      label: string
      mutates: boolean
      state: ToolItemState
      summary: string
      links: AiLink[]
    }
  | {
      kind: 'confirm'
      key: string
      id: string
      tool: string
      label: string
      question: string
      fields: AiConfirmField[]
      /** undefined until the user presses Confirmar/Cancelar. */
      decision?: boolean
    }
  | { kind: 'notice'; key: string; text: string }
  | { kind: 'error'; key: string; text: string; recovery: ErrorRecovery }

/** What the user may do about a failed turn. A safety decision — see `run` in use-ai-chat. */
export type ErrorRecovery =
  /** The failed request carried no decisions, so re-sending it cannot execute a write. */
  | 'retry'
  /** The failed request carried decisions: a write may have landed. Never auto-resend. */
  | 'continue'
  | 'none'

export type ChatStatus = 'idle' | 'streaming' | 'awaiting_confirmation'

export interface ChatState {
  items: ChatItem[]
  /** The assistant bubble currently receiving text deltas, if any. */
  openAssistantKey: string | null
  status: ChatStatus
}

export const INITIAL_CHAT_STATE: ChatState = {
  items: [],
  openAssistantKey: null,
  status: 'idle',
}

let seq = 0
export const nextKey = (prefix: string): string => `${prefix}:${++seq}`

export const toolKey = (id: string): string => `tool:${id}`
export const confirmKey = (id: string): string => `confirm:${id}`

function upsert(items: ChatItem[], key: string, next: ChatItem): ChatItem[] {
  const index = items.findIndex((item) => item.key === key)
  if (index === -1) return [...items, next]

  const copy = [...items]
  copy[index] = next
  return copy
}

export function applyEvent(state: ChatState, event: AiEvent): ChatState {
  switch (event.type) {
    case 'text': {
      if (state.openAssistantKey !== null) {
        const key = state.openAssistantKey
        return {
          ...state,
          items: state.items.map((item) =>
            item.key === key && item.kind === 'assistant'
              ? { ...item, text: item.text + event.delta }
              : item,
          ),
        }
      }

      const key = nextKey('assistant')
      return {
        ...state,
        items: [...state.items, { kind: 'assistant', key, text: event.delta }],
        openAssistantKey: key,
      }
    }

    case 'tool_start': {
      const key = toolKey(event.id)
      const existing = state.items.find((item) => item.key === key)

      // A resume re-emits tool_start for the SAME tool_use ids (the server
      // recomputes an identical plan from the transcript). Upserting by id turns
      // that into an in-place "now actually running" instead of a duplicate row.
      return {
        ...state,
        items: upsert(state.items, key, {
          kind: 'tool',
          key,
          id: event.id,
          tool: event.tool,
          label: event.label,
          mutates: event.mutates,
          state: 'running',
          summary: '',
          links: existing && existing.kind === 'tool' ? existing.links : [],
        }),
      }
    }

    case 'tool_result': {
      const key = toolKey(event.id)
      const existing = state.items.find((item) => item.key === key)
      if (!existing || existing.kind !== 'tool') return state

      return {
        ...state,
        items: upsert(state.items, key, {
          ...existing,
          state: event.ok ? 'ok' : 'error',
          summary: event.summary,
          links: event.links,
        }),
      }
    }

    case 'confirm_required': {
      // The tool row for a staged mutation is not "running" — nothing is running.
      // It is waiting on a human.
      const items = state.items.map((item) =>
        item.kind === 'tool' && item.id === event.id
          ? { ...item, state: 'awaiting' as ToolItemState }
          : item,
      )

      return {
        ...state,
        items: upsert(items, confirmKey(event.id), {
          kind: 'confirm',
          key: confirmKey(event.id),
          id: event.id,
          tool: event.tool,
          label: event.label,
          question: event.question,
          fields: event.fields,
        }),
      }
    }

    case 'message':
      // Transcript growth is the caller's job (it lives in a ref, not in state).
      // Here the assistant turn only closes the open bubble, so the next round
      // starts a fresh one instead of appending to the previous answer.
      return event.message.role === 'assistant' ? { ...state, openAssistantKey: null } : state

    case 'done': {
      const items =
        event.stop === 'max_rounds'
          ? [
              ...state.items,
              {
                kind: 'notice' as const,
                key: nextKey('notice'),
                text: 'A IA atingiu o limite de passos. Peça o próximo passo com mais detalhes.',
              },
            ]
          : state.items

      return {
        items,
        openAssistantKey: null,
        status: event.stop === 'awaiting_confirmation' ? 'awaiting_confirmation' : 'idle',
      }
    }

    case 'error':
      return {
        items: [
          ...state.items,
          { kind: 'error', key: nextKey('error'), text: event.message, recovery: 'none' },
        ],
        openAssistantKey: null,
        status: 'idle',
      }
  }
}
