import type { Tables } from '@jobsiteos/core'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useEffect } from 'react'

import { useSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export type Notificacao = Tables<'notificacoes'>

/** Newest-first page size. The bell counts; the screen lists. */
const PAGE_SIZE = 100

export const notificacoesKeys = {
  /** Prefix — invalidating this refreshes both the list and the unread badge. */
  all: ['notificacoes'] as const,
  list: () => ['notificacoes', 'list'] as const,
  unread: () => ['notificacoes', 'unread'] as const,
}

// ─── Fetchers ───────────────────────────────────────────────────────────────
// RLS (`notificacoes_select_own`) already scopes every read to auth.uid(), so no
// usuario_id filter is needed here — and adding one would be a lie about where
// the guarantee comes from.

async function fetchNotificacoes(): Promise<Notificacao[]> {
  const { data, error } = await supabase
    .from('notificacoes')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(PAGE_SIZE)

  if (error) throw error
  return data ?? []
}

async function fetchUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notificacoes')
    .select('id', { count: 'exact', head: true })
    .eq('lida', false)

  if (error) throw error
  return count ?? 0
}

// ─── Realtime ───────────────────────────────────────────────────────────────

type Listener = () => void

/**
 * ONE websocket channel for the whole app, ref-counted.
 *
 * The bell and the list screen both want live updates, and the bell is mounted
 * on every screen — subscribing per component would open a second channel on the
 * same topic (Supabase warns and the payload arrives twice). So the channel is a
 * module singleton: the first subscriber opens it, the last one closes it.
 *
 * `notificacoes` is in the `supabase_realtime` publication (migration 0010) and
 * Realtime evaluates RLS per subscriber with the caller's JWT, so this stream can
 * only ever carry rows this user is allowed to SELECT. The usuario_id filter is
 * therefore an optimisation (less traffic), not the security boundary.
 */
let channel: RealtimeChannel | null = null
let channelUserId: string | null = null
const listeners = new Set<Listener>()

function teardownChannel(): void {
  if (!channel) return
  void supabase.removeChannel(channel)
  channel = null
  channelUserId = null
}

function ensureChannel(userId: string): void {
  // A different user signed in on this device: the old channel carries the old
  // JWT and the old filter. Replace it.
  if (channel && channelUserId === userId) return
  teardownChannel()

  channelUserId = userId
  channel = supabase
    .channel(`notificacoes:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notificacoes',
        filter: `usuario_id=eq.${userId}`,
      },
      () => {
        for (const listener of [...listeners]) listener()
      },
    )
    .subscribe()
}

function subscribeNotificacoes(userId: string, listener: Listener): () => void {
  listeners.add(listener)
  ensureChannel(userId)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) teardownChannel()
  }
}

/**
 * Live updates for the bell and the list. Safe to call from several components:
 * they share the single channel above.
 *
 * INSERTs arrive from notify() / the empresa_eventos fan-out trigger, UPDATEs
 * from another device marking the same row read. Both just invalidate — the
 * payload is not trusted as the new state, the refetch is (and it goes through
 * RLS again).
 */
export function useNotificacoesRealtime(): void {
  const { user } = useSession()
  const queryClient = useQueryClient()
  const userId = user?.id

  useEffect(() => {
    if (!userId) return

    return subscribeNotificacoes(userId, () => {
      void queryClient.invalidateQueries({ queryKey: notificacoesKeys.all })
    })
  }, [userId, queryClient])
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export function useNotificacoes(): UseQueryResult<Notificacao[], Error> {
  const { user } = useSession()

  return useQuery({
    queryKey: notificacoesKeys.list(),
    queryFn: fetchNotificacoes,
    enabled: Boolean(user),
  })
}

export function useUnreadCount(enabled = true): UseQueryResult<number, Error> {
  const { user } = useSession()

  return useQuery({
    queryKey: notificacoesKeys.unread(),
    queryFn: fetchUnreadCount,
    enabled: enabled && Boolean(user),
  })
}

/**
 * `lida` is the only column the update policy lets a user touch, and only on
 * their own rows. Optimistic: the tap that marks a notification read also
 * navigates away, so waiting for the round trip would show a stale unread dot
 * on the way back.
 */
export function useMarcarLida() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('notificacoes').update({ lida: true }).eq('id', id)
      if (error) throw error
    },
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: notificacoesKeys.all })

      const listaAnterior = queryClient.getQueryData<Notificacao[]>(notificacoesKeys.list())
      const naoLidasAnterior = queryClient.getQueryData<number>(notificacoesKeys.unread())
      const jaLida = listaAnterior?.find((n) => n.id === id)?.lida ?? false

      queryClient.setQueryData<Notificacao[]>(notificacoesKeys.list(), (atual) =>
        atual?.map((n) => (n.id === id ? { ...n, lida: true } : n)),
      )
      if (!jaLida) {
        queryClient.setQueryData<number>(notificacoesKeys.unread(), (atual) =>
          Math.max(0, (atual ?? 0) - 1),
        )
      }

      return { listaAnterior, naoLidasAnterior }
    },
    onError: (_error, _id, context) => {
      if (!context) return
      queryClient.setQueryData(notificacoesKeys.list(), context.listaAnterior)
      queryClient.setQueryData(notificacoesKeys.unread(), context.naoLidasAnterior)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificacoesKeys.all })
    },
  })
}

export function useMarcarTodasLidas() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<void> => {
      // No id list: RLS restricts the UPDATE to this user's rows, so "all unread"
      // means all of MY unread — the filter cannot reach a colleague's row.
      const { error } = await supabase
        .from('notificacoes')
        .update({ lida: true })
        .eq('lida', false)

      if (error) throw error
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificacoesKeys.all })

      const listaAnterior = queryClient.getQueryData<Notificacao[]>(notificacoesKeys.list())
      const naoLidasAnterior = queryClient.getQueryData<number>(notificacoesKeys.unread())

      queryClient.setQueryData<Notificacao[]>(notificacoesKeys.list(), (atual) =>
        atual?.map((n) => (n.lida ? n : { ...n, lida: true })),
      )
      queryClient.setQueryData<number>(notificacoesKeys.unread(), 0)

      return { listaAnterior, naoLidasAnterior }
    },
    onError: (_error, _vars, context) => {
      if (!context) return
      queryClient.setQueryData(notificacoesKeys.list(), context.listaAnterior)
      queryClient.setQueryData(notificacoesKeys.unread(), context.naoLidasAnterior)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificacoesKeys.all })
    },
  })
}
