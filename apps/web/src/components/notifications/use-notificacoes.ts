'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { marcarComoLida, marcarTodasComoLidas } from '@/actions/notificacoes'

export interface Notificacao {
  id: string
  titulo: string
  corpo: string | null
  url: string | null
  lida: boolean
  criado_em: string
}

/** The bell is a bell, not an archive. /notificacoes shows the same window. */
const LIMITE = 50

const chaveNotificacoes = (usuarioId: string | null) => ['notificacoes', usuarioId] as const

export interface UseNotificacoes {
  notificacoes: Notificacao[]
  naoLidas: number
  isLoading: boolean
  isError: boolean
  recarregar: () => void
  marcarUma: (id: string) => void
  marcarTodas: () => void
  marcandoTodas: boolean
}

/**
 * Single source of truth for both the bell and /notificacoes — they render the
 * same query cache, so marking something read in one updates the other with no
 * cross-component plumbing.
 *
 * Reads go through the browser client on purpose: `notificacoes_select_own`
 * (usuario_id = auth.uid()) makes RLS the thing that scopes the list, so there
 * is no server round trip and no way for this to leak a colleague's rows.
 */
export function useNotificacoes(): UseNotificacoes {
  const supabase = React.useMemo(() => createClient(), [])
  const queryClient = useQueryClient()

  // The bell takes no props (the shell mounts <NotificationsBell /> bare), so it
  // resolves its own identity. getUser() revalidates the JWT against the auth
  // server rather than trusting the cookie's claims.
  const usuario = useQuery({
    queryKey: ['auth', 'usuario-id'],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.auth.getUser()
      if (error) throw new Error(error.message)
      return data.user?.id ?? null
    },
    staleTime: Infinity,
  })

  const usuarioId = usuario.data ?? null

  const query = useQuery({
    queryKey: chaveNotificacoes(usuarioId),
    enabled: usuarioId !== null,
    queryFn: async (): Promise<Notificacao[]> => {
      const { data, error } = await supabase
        .from('notificacoes')
        .select('id, titulo, corpo, url, lida, criado_em')
        .order('criado_em', { ascending: false })
        .limit(LIMITE)

      if (error) throw new Error(error.message)
      return data ?? []
    },
  })

  // ─── Realtime ─────────────────────────────────────────────────────────────
  // Requires notificacoes to be in the `supabase_realtime` publication
  // (migration 0010 — it was empty before, so this silently emitted nothing).
  React.useEffect(() => {
    if (usuarioId === null) return

    let canal: RealtimeChannel | null = null
    let cancelado = false

    const invalidar = () => {
      void queryClient.invalidateQueries({ queryKey: chaveNotificacoes(usuarioId) })
    }

    const conectar = async () => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (token === undefined || cancelado) return

      // Realtime enforces RLS using the JWT attached to the socket, not the one
      // on the REST client. Without this the subscription connects and then
      // never receives a row.
      supabase.realtime.setAuth(token)

      canal = supabase
        .channel(`notificacoes:${usuarioId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notificacoes',
            // Server-side filter: a colleague's row is never even put on our
            // socket. RLS would reject it anyway; this saves the round trip.
            filter: `usuario_id=eq.${usuarioId}`,
          },
          invalidar,
        )
        .subscribe((status) => {
          // Refetch once the socket is actually live. Realtime registers its
          // postgres_changes filters slightly AFTER the join completes, so a row
          // written in that window is delivered to nobody — and the initial
          // fetch may already have returned without it. Verified: firing an
          // INSERT immediately after SUBSCRIBED is genuinely dropped. Without
          // this the bell would sit stale until the next refetch.
          //
          // Also covers reconnects (laptop wakes, network flaps): the socket
          // resubscribes and we resync whatever was missed while it was down.
          if (status === 'SUBSCRIBED') invalidar()
        })
    }

    void conectar()

    // An access token lives ~1h. When it rotates, the socket must be re-authed
    // or the subscription goes quiet the moment the old token expires.
    const { data: listener } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      if (sessao?.access_token !== undefined) {
        supabase.realtime.setAuth(sessao.access_token)
      }
    })

    return () => {
      cancelado = true
      listener.subscription.unsubscribe()
      if (canal !== null) void supabase.removeChannel(canal)
    }
  }, [supabase, usuarioId, queryClient])

  // ─── Mutations ────────────────────────────────────────────────────────────
  // Optimistic, because a bell badge that lags a click feels broken. Realtime
  // then delivers the authoritative row and reconciles.

  const uma = useMutation({
    mutationFn: async (id: string) => {
      const resultado = await marcarComoLida(id)
      if (!resultado.ok) throw new Error(resultado.erro)
    },
    onMutate: async (id: string) => {
      const queryKey = chaveNotificacoes(usuarioId)
      await queryClient.cancelQueries({ queryKey })
      const anterior = queryClient.getQueryData<Notificacao[]>(queryKey)
      queryClient.setQueryData<Notificacao[]>(queryKey, (atual) =>
        (atual ?? []).map((n) => (n.id === id ? { ...n, lida: true } : n)),
      )
      return { anterior }
    },
    onError: (_erro, _id, context) => {
      if (context?.anterior !== undefined) {
        queryClient.setQueryData(chaveNotificacoes(usuarioId), context.anterior)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: chaveNotificacoes(usuarioId) })
    },
  })

  const todas = useMutation({
    mutationFn: async () => {
      const resultado = await marcarTodasComoLidas()
      if (!resultado.ok) throw new Error(resultado.erro)
    },
    onMutate: async () => {
      const queryKey = chaveNotificacoes(usuarioId)
      await queryClient.cancelQueries({ queryKey })
      const anterior = queryClient.getQueryData<Notificacao[]>(queryKey)
      queryClient.setQueryData<Notificacao[]>(queryKey, (atual) =>
        (atual ?? []).map((n) => ({ ...n, lida: true })),
      )
      return { anterior }
    },
    onError: (_erro, _vars, context) => {
      if (context?.anterior !== undefined) {
        queryClient.setQueryData(chaveNotificacoes(usuarioId), context.anterior)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: chaveNotificacoes(usuarioId) })
    },
  })

  const notificacoes = query.data ?? []

  return {
    notificacoes,
    naoLidas: notificacoes.filter((n) => !n.lida).length,
    // The identity lookup gates the list query, so it is part of "loading".
    isLoading: usuario.isPending || (usuarioId !== null && query.isPending),
    isError: usuario.isError || query.isError,
    recarregar: () => void query.refetch(),
    marcarUma: (id: string) => uma.mutate(id),
    marcarTodas: () => todas.mutate(),
    marcandoTodas: todas.isPending,
  }
}
