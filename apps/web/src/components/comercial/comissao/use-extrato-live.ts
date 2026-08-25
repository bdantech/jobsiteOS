'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

/**
 * O extrato do mês corrente, ao vivo (§6).
 *
 * `comissao_lancamentos_v2` está na publicação `supabase_realtime` (migração 0132), e
 * estar nela NÃO fura a RLS: o Realtime avalia a policy contra o JWT do socket linha a
 * linha, então o vendedor nunca recebe o lançamento do colega.
 *
 * Só assina a competência CORRENTE. Um mês fechado é imutável por construção — assinar
 * o passado seria manter um socket aberto esperando um evento que não pode acontecer.
 *
 * Devolve se o socket está de fato vivo, e a tela mostra isso: um selo "ao vivo" que
 * mente é pior que não ter selo nenhum — a pessoa para de recarregar justamente quando
 * precisaria.
 */
export function useExtratoLive(competencia: string, ehCorrente: boolean): boolean {
  const queryClient = useQueryClient()
  const supabase = React.useMemo(() => createClient(), [])
  const [vivo, setVivo] = React.useState(false)

  React.useEffect(() => {
    if (!ehCorrente) {
      setVivo(false)
      return
    }

    let canal: RealtimeChannel | null = null
    let cancelado = false

    const invalidar = () => {
      void queryClient.invalidateQueries({ queryKey: ['comercial', 'comissao-v2'] })
    }

    const conectar = async () => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (token === undefined || cancelado) return
      // O Realtime aplica a RLS com o JWT do SOCKET, não o do client REST. Sem isto a
      // assinatura conecta, reporta SUBSCRIBED e nunca entrega nada.
      supabase.realtime.setAuth(token)

      canal = supabase
        .channel(`comissoes:${competencia}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'comissao_lancamentos_v2',
            filter: `competencia=eq.${competencia}`,
          },
          invalidar,
        )
        .subscribe((status) => {
          if (cancelado) return
          setVivo(status === 'SUBSCRIBED')
          // O Realtime registra os filtros LOGO DEPOIS do join, e uma linha escrita
          // nessa janela não chega a ninguém. Refazer a busca ao subscrever cobre isso
          // — e cobre também a reconexão depois de o notebook acordar.
          if (status === 'SUBSCRIBED') invalidar()
        })
    }

    void conectar()

    const { data: listener } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      if (sessao?.access_token !== undefined) supabase.realtime.setAuth(sessao.access_token)
    })

    return () => {
      cancelado = true
      setVivo(false)
      listener.subscription.unsubscribe()
      if (canal !== null) void supabase.removeChannel(canal)
    }
  }, [supabase, queryClient, competencia, ehCorrente])

  return vivo
}

/** A competência do mês corrente, no calendário de São Paulo. */
export function competenciaCorrente(): string {
  const agora = new Date()
  const sp = new Date(agora.getTime() - 3 * 3_600_000)
  return `${sp.toISOString().slice(0, 7)}-01`
}
