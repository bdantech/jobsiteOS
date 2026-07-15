'use client'

import * as React from 'react'
import { Logo } from '@/components/brand/logo'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SidebarNav } from '@/components/shell/sidebar-nav'
import { UserMenu, type ShellUsuario } from '@/components/shell/user-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'

interface AppSidebarProps {
  usuario: ShellUsuario
  grantedModuleIds: string[]
}

/**
 * The application's sidebar: logo, the registry's modules, the user menu.
 *
 * `collapsible="icon"` is the whole shape of it — at `lg`+ it collapses to a 3rem rail of
 * icons (each one keeping its name as a tooltip), and below `lg` the same tree is served
 * as a drawer by the Sheet inside <Sidebar>. One definition, three renderings.
 */
export function AppSidebar({ usuario, grantedModuleIds }: AppSidebarProps) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

  // Following a link inside the drawer must close it. Keyed on the pathname rather than
  // on the click, so a navigation triggered from anywhere (the AI Bar, a tab) closes it
  // too. Guarded on isMobile: on desktop there is no drawer to close, and calling this on
  // every navigation would be pointless state churn.
  React.useEffect(() => {
    if (isMobile) setOpenMobile(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pathname is the trigger; re-running on isMobile/setOpenMobile identity would close the drawer the user just opened
  }, [pathname])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              tooltip="JobsiteOS — início"
              // Fechada, a barra esconde o wordmark e sobra só a marca. Sem isto ela fica
              // encostada à esquerda da caixa do botão (o <a> é `flex items-center`, e um
              // único filho de 16px numa caixa de 32px começa no x=0 dela) — desalinhada
              // dos ícones da nav logo abaixo, que são centrados pelo padding deles.
              className="group-data-[collapsible=icon]:justify-center"
            >
              <Link href="/">
                {/* Sem tile de fundo: a marca traz as próprias cores, e um quadrado navy
                    atrás de um logo azul vira mancha. Ela fica sobre a superfície da
                    sidebar, que é neutra justamente para isso.

                    Sem classe de tamanho, também de propósito: quem dimensiona é a cva do
                    SidebarMenuButton (`[&>svg]:size-4`), cujo seletor tem especificidade maior
                    que uma classe solta aqui — um `size-8` neste elemento seria silenciosamente
                    ignorado. 16px é o tamanho certo, o mesmo dos ícones da nav.

                    title={null} porque o texto ao lado já diz "JobsiteOS / ONE OS" — um
                    aria-label aqui faria o leitor de tela anunciar a marca duas vezes. */}
                <Logo className="shrink-0" title={null} />
                {/* On the collapsed rail the mark stands alone: the wordmark is hidden, not
                    merely clipped by overflow. `hidden` also takes it out of the accessibility
                    tree, which is what we want — the button already carries the tooltip
                    "JobsiteOS — início", so leaving the text present would announce the brand
                    twice to a screen reader on a 3rem rail that shows none of it. */}
                <span className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-semibold">JobsiteOS</span>
                  <span className="truncate text-xs text-sidebar-foreground/70">ONE OS</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarNav grantedModuleIds={grantedModuleIds} />
      </SidebarContent>

      <SidebarFooter>
        <UserMenu usuario={usuario} />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
