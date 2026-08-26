'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { BETA_PADRAO, type EstadoBeta } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'
import { buscarEstadoBeta, reportsKeys } from './queries'

/**
 * O estado do modo beta, ao vivo (§5).
 *
 * Realtime, e não um refetch periódico: ligar a tarja é o gesto de quem acabou
 * de subir uma versão e quer que a empresa inteira saiba AGORA. Exigir F5 —
 * ou pior, novo login — faria o aviso chegar a quem já tinha visto o problema.
 *
 * `app_config` entrou na publicação na migração 0141. Sem isso a assinatura
 * conecta, reporta SUBSCRIBED e nunca emite nada — o no-op silencioso que a 0010
 * documentou para o sino.
 */
export function useBeta(): EstadoBeta {
  const supabase = React.useMemo(() => createClient(), [])
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: reportsKeys.beta(),
    queryFn: buscarEstadoBeta,
    // A tarja é moldura, não dado de tela: sem janela de stale ela seria
    // rebuscada a cada montagem de componente que a usa.
    staleTime: 5 * 60_000,
  })

  React.useEffect(() => {
    let canal: RealtimeChannel | null = null
    let cancelado = false

    const invalidar = () => {
      void queryClient.invalidateQueries({ queryKey: reportsKeys.beta() })
    }

    const conectar = async () => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (token === undefined || cancelado) return

      // O Realtime aplica RLS com o JWT do SOCKET, não com o do cliente REST.
      // Sem isto a assinatura conecta e nunca recebe linha nenhuma.
      supabase.realtime.setAuth(token)

      canal = supabase
        .channel('app-config-beta')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'app_config',
            // Filtro do lado do servidor: as outras chaves de configuração não
            // precisam nem sair do banco para chegar até aqui.
            filter: 'chave=eq.beta',
          },
          invalidar,
        )
        .subscribe((status) => {
          // Ressincroniza quando o socket fica de fato vivo — e de novo a cada
          // reconexão (notebook acorda, rede oscila), que é quando uma tarja
          // ligada no meio do caminho teria passado despercebida.
          if (status === 'SUBSCRIBED') invalidar()
        })
    }

    void conectar()

    const { data: listener } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      if (sessao?.access_token !== undefined) supabase.realtime.setAuth(sessao.access_token)
    })

    return () => {
      cancelado = true
      listener.subscription.unsubscribe()
      if (canal !== null) void supabase.removeChannel(canal)
    }
  }, [supabase, queryClient])

  // Enquanto carrega (e se falhar), DESLIGADO. Piscar uma tarja âmbar em toda
  // navegação seria pior que o aviso vale.
  return query.data ?? { ...BETA_PADRAO, habilitado: false }
}
