'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AiBarTrigger } from '@/components/ai/ai-bar-trigger'
import { AvisoNaoVinculadas } from '@/components/comunicacao/aviso-nao-vinculadas'
import { NotificationsBell } from '@/components/notifications/bell'
import { ReportTrigger } from '@/components/reports/report-trigger'
import { TabBar } from '@/components/shell/tab-bar'
import { useTabsStoreApi } from '@/components/shell/tabs-store-provider'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

interface TopBarProps {
  grantedModuleIds: string[]
  /** Quem está logado. O botão de reportar carrega "Meus reports" com ele. */
  usuarioId: string
}

export function TopBar({ grantedModuleIds, usuarioId }: TopBarProps) {
  const router = useRouter()
  const store = useTabsStoreApi()

  /**
   * The AI ↔ shell seam. Without this, <AiBarTrigger/> falls back to a bare
   * router.push and a result the AI surfaced ("abre a empresa X") would replace
   * the current tab's route instead of opening its own tab. The store is read
   * through getState() rather than a selector: this never needs to re-render the
   * header, it just needs the current writer.
   */
  const abrirRota = useCallback(
    (route: string, label: string) => {
      store.getState().openTab(route, label, { activate: true })
      router.push(route)
    },
    [router, store],
  )

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b bg-muted/30 px-2">
      {/*
        One control, both jobs: below `lg` it opens the drawer, at `lg`+ it collapses the
        sidebar to the icon rail. It replaced a hamburger that only ever did the first —
        and it is the visible half of Cmd/Ctrl+B, which the SidebarProvider binds.
      */}
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 h-4 shrink-0" />

      <div className="min-w-0 flex-1">
        <TabBar grantedModuleIds={grantedModuleIds} />
      </div>

      {/*
        The bell is mounted exactly once in the whole shell, and this is the place: two
        instances would mean two Realtime subscriptions and two unread queries for one
        badge. It used to move to the sidebar footer on desktop, which the icon rail ends:
        a badge you can only see by expanding a sidebar is not a badge.
      */}
      {/*
        Reportar fica ao LADO do sino, e não dentro de um menu: os dois são a mesma
        classe de coisa — o canal entre a plataforma e quem a usa —, um de dentro
        para fora e o outro de fora para dentro.
      */}
      <div className="flex shrink-0 items-center gap-1">
        {/*
          A fila de identificação fica AO LADO do sino, e não dentro do módulo: o
          sistema não tem home (quem entra cai no primeiro módulo liberado), e uma
          mensagem de um decisor que ninguém identificou não pode depender de a
          pessoa abrir a tela certa. Só aparece para quem tem o módulo, e só
          quando há fila.
        */}
        <AvisoNaoVinculadas temModulo={grantedModuleIds.includes('comunicacao')} />
        <AiBarTrigger onOpenRoute={abrirRota} />
        <ReportTrigger usuarioId={usuarioId} />
        <NotificationsBell />
      </div>
    </header>
  )
}
