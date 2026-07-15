'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { Condicao } from '@jobsiteos/core'
import { useTabsStoreApi } from '@/components/shell/tabs-store-provider'
import { arvoreDe, ROTA_EXPLORADOR, rotaExploradorComFiltro } from '../queries'

/**
 * "Clicar em qualquer fatia abre o Explorador pré-filtrado" — and on web that means
 * a NEW TAB, exactly like the AI Bar does it (see TopBar.abrirRota): the store gets
 * the tab, the router does the navigating. The Mapa is a place you come back to, so
 * drilling into a slice must not consume the tab you were reading.
 *
 * A tab stores a PATHNAME only (stores/tabs.ts), so the filter itself rides in the
 * query string of the push. Consequence, and it is the shell's rule, not ours:
 * re-activating that tab later reopens the Explorador unfiltered.
 */
export function useAbrirExplorador(): (condicoes: Condicao[], titulo: string) => void {
  const router = useRouter()
  const store = useTabsStoreApi()

  return React.useCallback(
    (condicoes: Condicao[], titulo: string) => {
      if (condicoes.length === 0) return

      // rotaExploradorComFiltro → JSON in the query string; the Explorador validates
      // it with the engine's zod schema on the way back in.
      const rota = rotaExploradorComFiltro(arvoreDe(condicoes))

      store.getState().openTab(ROTA_EXPLORADOR, titulo, { activate: true })
      router.push(rota)
    },
    [router, store],
  )
}
