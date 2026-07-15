import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  danglingToolUseIds,
  interruptedResultsTurn,
  type AiEvent,
  type AiMessage,
  type AiRequest,
} from './protocol'
import {
  applyEvent,
  nextKey,
  INITIAL_CHAT_STATE,
  type ChatItem,
  type ChatState,
  type ChatStatus,
  type ErrorRecovery,
} from './reducer'
import { AiStreamError, isAiStreamAbort, streamAiTurn } from './stream'

export type { ChatItem, ChatStatus, ErrorRecovery, ToolItemState } from './reducer'

/**
 * Orchestrates one AI conversation: the wire transcript, the request lifecycle,
 * and the confirmation round-trip. The render model is built by ./reducer.
 *
 * The transcript is the delicate part. /api/ai is stateless, so the CLIENT owns
 * the history and replays it on every request — which means it must stay valid
 * for the Anthropic Messages API at all times. Two rules follow, and every
 * rollback path below exists to enforce them:
 *
 *   1. A tool_use block must be answered by a tool_result. A turn that died
 *      mid-flight leaves a dangling one, and replaying it is an instant 400.
 *   2. Two user turns may not follow each other — so a dangling tool_use cannot
 *      be "fixed" by dropping the assistant turn either. It must be answered.
 */

export interface AiChat {
  items: ChatItem[]
  status: ChatStatus
  /** Streaming with nothing to paint yet — render the skeleton bubble. */
  thinking: boolean
  /** False while streaming, while a confirmation is pending, or on a broken transcript. */
  canSend: boolean
  send: (text: string) => void
  /** Records the verdict for one staged mutation. Resumes once the round is fully decided. */
  decide: (id: string, approved: boolean) => void
  /** Re-runs a failed turn. Only ever offered when that turn carried no decisions. */
  retry: () => void
  /** Closes out an interrupted tool round so the chat can continue. Executes nothing. */
  recover: () => void
  stop: () => void
  reset: () => void
}

export function useAiChat(route: string | null): AiChat {
  // stateRef is the source of truth; React state is a mirror for rendering. The
  // reducer therefore never runs inside a setState updater — React is free to
  // invoke those twice, which would double-append items and double-advance keys.
  const stateRef = useRef<ChatState>(INITIAL_CHAT_STATE)
  const [items, setItems] = useState<ChatItem[]>(INITIAL_CHAT_STATE.items)
  const [status, setStatus] = useState<ChatStatus>(INITIAL_CHAT_STATE.status)
  const [blocked, setBlocked] = useState(false)

  // Read inside async callbacks, where captured state would be stale.
  const messagesRef = useRef<AiMessage[]>([])
  const decisionsRef = useRef<Record<string, boolean>>({})
  /** Confirmations the CURRENT pending round is waiting on. */
  const pendingConfirmsRef = useRef<string[]>([])
  /** Confirmations seen during the in-flight turn; promoted to pending on `done`. */
  const turnConfirmsRef = useRef<string[]>([])
  /** The exact request in flight — the unit of both rollback and retry. */
  const lastRequestRef = useRef<{
    messages: AiMessage[]
    decisions: Record<string, boolean>
  } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const routeRef = useRef<string | null>(route)
  const mountedRef = useRef(true)

  routeRef.current = route

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const commit = useCallback((next: ChatState): void => {
    stateRef.current = next
    setItems(next.items)
    setStatus(next.status)
  }, [])

  const setTranscript = useCallback((messages: AiMessage[]): void => {
    messagesRef.current = messages
    setBlocked(danglingToolUseIds(messages).length > 0)
  }, [])

  const run = useCallback(
    async (messages: AiMessage[], decisions: Record<string, boolean>): Promise<void> => {
      const controller = new AbortController()
      abortRef.current = controller
      lastRequestRef.current = { messages, decisions }
      turnConfirmsRef.current = []

      commit({ ...stateRef.current, status: 'streaming' })

      const body: AiRequest = {
        messages,
        ...(routeRef.current ? { route: routeRef.current } : {}),
        ...(Object.keys(decisions).length > 0 ? { decisions } : {}),
      }

      try {
        await streamAiTurn({
          body,
          signal: controller.signal,
          onEvents: (events: AiEvent[]) => {
            if (!mountedRef.current) return

            for (const event of events) {
              if (event.type === 'message') {
                // Verbatim, in order: this is the history the next turn replays.
                setTranscript([...messagesRef.current, event.message])
              } else if (event.type === 'confirm_required') {
                turnConfirmsRef.current = [...turnConfirmsRef.current, event.id]
              } else if (event.type === 'done' && event.stop === 'awaiting_confirmation') {
                pendingConfirmsRef.current = turnConfirmsRef.current
              }
            }

            // One commit per network chunk, not one per token.
            commit(events.reduce(applyEvent, stateRef.current))
          },
        })

        // The server closed without a `done` frame (proxy cut, deploy mid-stream).
        // Don't leave the composer disabled forever.
        if (mountedRef.current && stateRef.current.status === 'streaming') {
          commit({ ...stateRef.current, status: 'idle', openAssistantKey: null })
        }
      } catch (error) {
        if (!mountedRef.current) return

        // ── Rollback ────────────────────────────────────────────────────────
        // A broken turn leaves the transcript half-grown: the assistant turn may
        // have arrived while its tool_results never did. Replaying that is an
        // instant 400, so the transcript goes back to EXACTLY what we sent. The
        // UI keeps its items — the user saw what happened, and pretending
        // otherwise would be a lie — but the wire history does not.
        setTranscript([...messages])

        if (isAiStreamAbort(error)) {
          // Stopping a resume leaves the staged tool_use dangling. Close it out
          // truthfully (see interruptedResultsTurn) instead of stranding the chat.
          const dangling = danglingToolUseIds(messagesRef.current)
          if (dangling.length > 0) {
            setTranscript([...messagesRef.current, interruptedResultsTurn(dangling)])
          }

          pendingConfirmsRef.current = []
          commit({
            items: [
              ...stateRef.current.items,
              { kind: 'notice', key: nextKey('notice'), text: 'Geração interrompida.' },
            ],
            openAssistantKey: null,
            status: 'idle',
          })
          return
        }

        const message =
          error instanceof AiStreamError ? error.message : 'Falha na IA. Tente novamente.'

        // The recovery offered turns on ONE question: could re-sending this
        // request execute a write? A request carrying decisions has already
        // authorised a mutation, and we cannot know whether the server ran it
        // before the socket died — so it is never silently re-sent.
        const recovery: ErrorRecovery = Object.keys(decisions).length > 0 ? 'continue' : 'retry'

        commit({
          items: [
            ...stateRef.current.items,
            { kind: 'error', key: nextKey('error'), text: message, recovery },
          ],
          openAssistantKey: null,
          status: 'idle',
        })
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [commit, setTranscript],
  )

  const send = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (stateRef.current.status !== 'idle') return
      // Never append a user turn after an unanswered tool_use — see rule 2 above.
      if (danglingToolUseIds(messagesRef.current).length > 0) return

      const messages: AiMessage[] = [
        ...messagesRef.current,
        { role: 'user', content: [{ type: 'text', text: trimmed }] },
      ]

      setTranscript(messages)
      commit({
        items: [...stateRef.current.items, { kind: 'user', key: nextKey('user'), text: trimmed }],
        openAssistantKey: null,
        status: 'streaming',
      })

      void run(messages, decisionsRef.current)
    },
    [commit, run, setTranscript],
  )

  const decide = useCallback(
    (id: string, approved: boolean): void => {
      if (stateRef.current.status !== 'awaiting_confirmation') return
      if (id in decisionsRef.current) return

      decisionsRef.current = { ...decisionsRef.current, [id]: approved }

      commit({
        ...stateRef.current,
        items: stateRef.current.items.map((item) =>
          item.kind === 'confirm' && item.id === id ? { ...item, decision: approved } : item,
        ),
      })

      // A round can stage more than one mutation. Nothing resumes — and nothing
      // executes — until the user has ruled on every one of them.
      const allDecided = pendingConfirmsRef.current.every(
        (pendingId) => pendingId in decisionsRef.current,
      )
      if (!allDecided) return

      pendingConfirmsRef.current = []

      // The transcript already ends with the assistant turn that asked for the
      // tools; the resume replays it as-is, plus the verdicts.
      void run([...messagesRef.current], decisionsRef.current)
    },
    [commit, run],
  )

  const retry = useCallback((): void => {
    const request = lastRequestRef.current
    if (!request || stateRef.current.status !== 'idle') return
    if (Object.keys(request.decisions).length > 0) return // never re-fire an authorised write

    commit({
      ...stateRef.current,
      items: stateRef.current.items.filter((item) => item.kind !== 'error'),
    })
    void run(request.messages, request.decisions)
  }, [commit, run])

  const recover = useCallback((): void => {
    const dangling = danglingToolUseIds(messagesRef.current)
    if (dangling.length === 0) return

    setTranscript([...messagesRef.current, interruptedResultsTurn(dangling)])
    pendingConfirmsRef.current = []

    commit({
      items: [
        ...stateRef.current.items.filter((item) => item.kind !== 'error'),
        {
          kind: 'notice',
          key: nextKey('notice'),
          text: 'Ação interrompida. Verifique se ela foi concluída antes de pedir de novo.',
        },
      ],
      openAssistantKey: null,
      status: 'idle',
    })
  }, [commit, setTranscript])

  const stop = useCallback((): void => {
    abortRef.current?.abort()
  }, [])

  const reset = useCallback((): void => {
    abortRef.current?.abort()
    abortRef.current = null

    setTranscript([])
    commit(INITIAL_CHAT_STATE)

    decisionsRef.current = {}
    pendingConfirmsRef.current = []
    turnConfirmsRef.current = []
    lastRequestRef.current = null
  }, [commit, setTranscript])

  // A tool row carries its own spinner and a streaming bubble is its own progress
  // indicator: the skeleton is only for the gap before either exists.
  const thinking = useMemo(() => {
    if (status !== 'streaming') return false
    const last = items[items.length - 1]
    if (last?.kind === 'assistant') return false
    return !items.some((item) => item.kind === 'tool' && item.state === 'running')
  }, [items, status])

  return {
    items,
    status,
    thinking,
    canSend: status === 'idle' && !blocked,
    send,
    decide,
    retry,
    recover,
    stop,
    reset,
  }
}
