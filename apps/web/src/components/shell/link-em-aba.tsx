'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTabsStoreApi } from '@/components/shell/tabs-store-provider'
import { titleForRoute } from '@/components/shell/route-title'

/**
 * Abrir uma tela sem perder a de onde se veio — na NOSSA barra de abas.
 *
 * O jeito antigo era `target="_blank"`, e ele resolvia a metade errada do problema: sim,
 * a tela de origem continuava aberta, mas noutra aba do NAVEGADOR — fora da barra de abas
 * do sistema, sem o estado do shell, e sem o "voltar" contextual. Pior: `RouteSync`
 * intercepta cmd+clique em links internos justamente para abrir uma aba nossa, e recusa
 * de propósito qualquer `<a>` com `target` diferente de `_self` (`internalRoute()`). Ou
 * seja, o `target="_blank"` desligava o sistema de abas exatamente onde ele era pedido.
 *
 * A regra do shell é que a aba guarda um PATHNAME, e quem navega é quem chama — o store
 * nunca navega sozinho. É o mesmo par `openTab` + `router.push` do `useAbrirExplorador` e
 * do `TopBar.abrirRota`.
 *
 * Só para rota INTERNA. Site de cliente, link de tribunal e afins continuam sendo
 * `target="_blank"`: aquilo não é uma tela nossa e não cabe numa aba nossa.
 */
export function useAbrirEmAba(): (rota: string, titulo?: string) => void {
  const router = useRouter()
  const store = useTabsStoreApi()

  return React.useCallback(
    (rota: string, titulo?: string) => {
      if (!rota.startsWith('/') || rota.startsWith('//')) return
      /* O título definitivo vem do `document.title` quando a página renderiza; este é o
         palpite síncrono, porque a aba nasce antes de a tela existir. */
      const pathname = rota.split('?')[0] ?? rota
      store.getState().openTab(pathname, titulo ?? titleForRoute(pathname), { activate: true })
      router.push(rota)
    },
    [router, store],
  )
}

export interface LinkEmAbaProps
  extends Omit<React.ComponentProps<typeof Link>, 'href' | 'target' | 'onClick'> {
  href: string
  /** Título da aba enquanto a página não diz o seu. Padrão: o do registry. */
  tituloDaAba?: string
}

/**
 * O `<Link>` que abre numa aba do sistema.
 *
 * Continua sendo um `<a>` de verdade com `href` — cmd+clique, clique do meio, "abrir em
 * nova aba" do menu do navegador e o leitor de tela seguem funcionando como devem. O que
 * o `onClick` faz é só trocar o comportamento do clique SIMPLES: em vez de trocar a tela
 * de baixo do usuário, ele abre uma aba nossa.
 */
export function LinkEmAba({ href, tituloDaAba, ...props }: LinkEmAbaProps) {
  const abrir = useAbrirEmAba()
  return (
    <Link
      {...props}
      href={href}
      onClick={(e) => {
        /* Deixa passar o que o navegador já trata: cmd/ctrl, shift, e o botão do meio —
           esses o RouteSync intercepta, e duplicar aqui abriria duas abas. */
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        abrir(href, tituloDaAba)
      }}
    />
  )
}
