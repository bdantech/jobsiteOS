'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AiBarTrigger } from '@/components/ai/ai-bar-trigger'
import { NotificationsBell } from '@/components/notifications/bell'
import { TabBar } from '@/components/shell/tab-bar'
import { useTabsStoreApi } from '@/components/shell/tabs-store-provider'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

interface TopBarProps {
  grantedModuleIds: string[]
}

export function TopBar({ grantedModuleIds }: TopBarProps) {
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
      <div className="flex shrink-0 items-center gap-1">
        <AiBarTrigger onOpenRoute={abrirRota} />
        <NotificationsBell />
      </div>
    </header>
  )
}
