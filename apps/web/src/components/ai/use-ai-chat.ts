'use client'

import { useCallback, useRef, useState } from 'react'
import type { AiConfirmField, AiEvent, AiLink, AiMessage } from '@/lib/ai/protocol'
import { streamAiTurn } from '@/lib/ai/stream-client'

export type AiChatStatus = 'idle' | 'streaming' | 'awaiting_confirmation' | 'error'

export type AiItem =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'assistant'; key: string; text: string }
  | {
      kind: 'tool'
      key: string
      id: string
      label: string
      status: 'running' | 'pending' | 'ok' | 'error'
      summary: string | null
      links: AiLink[]
    }
  | {
      kind: 'confirm'
      key: string
      id: string
      label: string
      question: string
      fields: AiConfirmField[]
      status: 'pending' | 'confirmed' | 'cancelled'
    }

/**
 * Drives one AI Bar conversation.
 *
 * Two sources of truth, on purpose:
 *  - `history` (a ref) is the transcript the SERVER dictates: it only ever grows
 *    with `message` events, and it is what gets replayed on the next turn. We
 *    never reconstruct it from the UI.
 *  - `items` is the rendering of the stream. It exists so the UI can show
 *    partial text and tool activity, which the transcript alone can't express.
 */
export function useAiChat(route?: string) {
  const [items, setItems] = useState<AiItem[]>([])
  const [status, setStatus] = useState<AiChatStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const history = useRef<AiMessage[]>([])
  /** tool_use id → verdict. `undefined` means the user hasn't answered yet. */
  const confirms = useRef<Map<string, boolean | undefined>>(new Map())
  const abort = useRef<AbortController | null>(null)
  const counter = useRef(0)
  /** The assistant bubble currently being streamed into, if any. */
  const openAssistant = useRef<string | null>(null)

  const nextKey = useCallback((prefix: string) => {
    counter.current += 1
    return `${prefix}-${counter.current}`
  }, [])

  const handleEvent = useCallback(
    (event: AiEvent) => {
      // Anything that isn't text ends the current assistant bubble, so the text
      // that comes after a tool call renders as a new paragraph, not a run-on.
      if (event.type !== 'text') openAssistant.current = null

      switch (event.type) {
        case 'text': {
          const key = openAssistant.current
          if (key) {
            setItems((prev) =>
              prev.map((item) =>
                item.key === key && item.kind === 'assistant'
                  ? { ...item, text: item.text + event.delta }
                  : item,
              ),
            )
          } else {
            const newKey = nextKey('assistant')
            openAssistant.current = newKey
            setItems((prev) => [...prev, { kind: 'assistant', key: newKey, text: event.delta }])
          }
          break
        }

        case 'tool_start': {
          setItems((prev) => {
            const existing = prev.find((item) => item.kind === 'tool' && item.id === event.id)
            if (existing) {
              return prev.map((item) =>
                item.kind === 'tool' && item.id === event.id
                  ? { ...item, status: 'running', summary: null }
                  : item,
              )
            }
            return [
              ...prev,
              {
                kind: 'tool',
                key: nextKey('tool'),
                id: event.id,
                label: event.label,
                status: 'running',
                summary: null,
                links: [],
              },
            ]
          })
          break
        }

        case 'tool_result': {
          setItems((prev) =>
            prev.map((item) =>
              item.kind === 'tool' && item.id === event.id
                ? {
                    ...item,
                    status: event.ok ? 'ok' : 'error',
                    summary: event.summary,
                    links: event.links,
                  }
                : item,
            ),
          )
          break
        }

        case 'confirm_required': {
          confirms.current.set(event.id, undefined)
          setItems((prev) => [
            // The tool row for this id was optimistically marked "running" by
            // tool_start; nothing ran — it is waiting on the user.
            ...prev.map((item) =>
              item.kind === 'tool' && item.id === event.id
                ? { ...item, status: 'pending' as const }
                : item,
            ),
            {
              kind: 'confirm',
              key: nextKey('confirm'),
              id: event.id,
              label: event.label,
              question: event.question,
              fields: event.fields,
              status: 'pending',
            },
          ])
          break
        }

        case 'message':
          history.current = [...history.current, event.message]
          break

        case 'done':
          setStatus(event.stop === 'awaiting_confirmation' ? 'awaiting_confirmation' : 'idle')
          break

        case 'error':
          setError(event.message)
          setStatus('error')
          break
      }
    },
    [nextKey],
  )

  const run = useCallback(
    async (decisions?: Record<string, boolean>) => {
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller

      setError(null)
      setStatus('streaming')
      openAssistant.current = null

      try {
        for await (const event of streamAiTurn({
          messages: history.current,
          route,
          decisions,
          signal: controller.signal,
        })) {
          handleEvent(event)
        }
      } catch (err) {
        // An abort is the user closing the bar or starting over — not an error.
        if (controller.signal.aborted) return
        console.error('[ai-bar]', err)
        setError('Conexão com a IA interrompida. Tente novamente.')
        setStatus('error')
      }
    },
    [handleEvent, route],
  )

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || status === 'streaming') return

      history.current = [...history.current, { role: 'user', content: [{ type: 'text', text: trimmed }] }]
      setItems((prev) => [...prev, { kind: 'user', key: nextKey('user'), text: trimmed }])
      await run()
    },
    [nextKey, run, status],
  )

  /**
   * Records the user's verdict on one staged mutation. The resume request only
   * goes out once EVERY pending confirmation of the round has an answer —
   * otherwise the server would just ask again for the ones still missing.
   */
  const decide = useCallback(
    async (id: string, approved: boolean) => {
      if (!confirms.current.has(id) || confirms.current.get(id) !== undefined) return

      confirms.current.set(id, approved)
      setItems((prev) =>
        prev.map((item) =>
          item.kind === 'confirm' && item.id === id
            ? { ...item, status: approved ? 'confirmed' : 'cancelled' }
            : item,
        ),
      )

      const stillPending = [...confirms.current.values()].some((value) => value === undefined)
      if (stillPending) return

      const decisions: Record<string, boolean> = {}
      for (const [toolUseId, value] of confirms.current) {
        if (value !== undefined) decisions[toolUseId] = value
      }
      confirms.current.clear()

      await run(decisions)
    },
    [run],
  )

  const reset = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    history.current = []
    confirms.current.clear()
    openAssistant.current = null
    setItems([])
    setError(null)
    setStatus('idle')
  }, [])

  return { items, status, error, send, decide, reset }
}
