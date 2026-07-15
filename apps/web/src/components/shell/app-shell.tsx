import { cookies } from 'next/headers'
import { AppSidebar } from '@/components/shell/app-sidebar'
import { RouteSync } from '@/components/shell/route-sync'
import { TabsStoreProvider } from '@/components/shell/tabs-store-provider'
import { TopBar } from '@/components/shell/topbar'
import type { ShellUsuario } from '@/components/shell/user-menu'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

interface AppShellProps {
  usuario: ShellUsuario
  grantedModuleIds: string[]
  children: React.ReactNode
}

/**
 * Must match SIDEBAR_COOKIE_NAME in components/ui/sidebar.tsx, which is where it is
 * written. It cannot be imported from there: that module is 'use client', and a server
 * component importing from a client module gets a client-reference proxy rather than the
 * string — reading it here would throw at render time, not at build time.
 */
const SIDEBAR_COOKIE_NAME = 'sidebar_state'

/**
 * The frame every authenticated page renders inside: sidebar, tab bar, AI Bar trigger,
 * notifications bell.
 *
 * A SERVER component, and that is the point of the redesign. The sidebar's collapsed
 * state lives in a cookie, so it can be read here, before a byte of HTML is sent, and
 * handed to SidebarProvider as `defaultOpen`. The old shell kept that flag in
 * localStorage: unreadable on the server, so every single page load rendered the sidebar
 * expanded and then snapped it shut after hydration.
 *
 * `children` stays a server-rendered tree handed across the client boundary — the pages
 * remain RSCs, this shell just wraps them. Which is also why the shell holds no page
 * state: the tab bar is navigation state (routes), and the route itself is the only thing
 * that decides what is mounted.
 */
export async function AppShell({ usuario, grantedModuleIds, children }: AppShellProps) {
  const cookieStore = await cookies()
  // Absent cookie → expanded. Only an explicit "false" collapses it.
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== 'false'

  return (
    <TabsStoreProvider userId={usuario.id} grantedModuleIds={grantedModuleIds}>
      <RouteSync />

      {/* h-dvh, not h-screen: on mobile Safari, 100vh is taller than the visible viewport,
          which would push the scroll container's bottom under the browser chrome.
          overflow-hidden pins the frame — nothing scrolls but <main>. */}
      <SidebarProvider defaultOpen={defaultOpen} className="h-dvh overflow-hidden">
        <AppSidebar usuario={usuario} grantedModuleIds={grantedModuleIds} />

        <SidebarInset className="overflow-hidden">
          <TopBar grantedModuleIds={grantedModuleIds} />

          {/*
            The only scroll container. Pages scroll; the shell never does.

            The page GUTTER lives here, once, and not in each page. It used to live
            nowhere: `<main>` had no padding and almost no page brought its own, so
            most screens rendered flush against the sidebar. Putting it in every page
            is how it drifts — one module ships p-6, the next p-4, and a third forgets.
          */}
          {/* bg-surface: a tela cinza sobre a qual os cards se levantam. Aqui, uma vez,
              pela mesma razão que o gutter — uma página que pinta o próprio fundo é uma
              página que vai divergir das outras. */}
          <main className="flex-1 overflow-y-auto bg-surface p-4 sm:p-6 lg:p-8">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TabsStoreProvider>
  )
}
