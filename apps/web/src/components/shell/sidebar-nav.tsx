'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { grantedModules } from '@jobsiteos/core'
import { moduleIcon } from '@/components/shell/icons'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

interface SidebarNavProps {
  grantedModuleIds: string[]
}

/**
 * The navigation IS the registry. There is no hardcoded list of links anywhere in this
 * app: `grantedModules()` decides what exists and what the user may see, so a module
 * that is not registered cannot appear, and a module the perfil does not grant cannot
 * either. Adding a module to packages/core makes it show up here with no edit.
 *
 * Collapse is not a prop any more. The icon rail is a CSS state of the Sidebar
 * (`group-data-[collapsible=icon]`), so this component does not know or care which width
 * it is being rendered at — it just names each item, and SidebarMenuButton turns that
 * name into the tooltip the rail needs.
 */
export function SidebarNav({ grantedModuleIds }: SidebarNavProps) {
  const pathname = usePathname()
  const modules = grantedModules(grantedModuleIds)

  // Empty state. A perfil with no modules is a misconfiguration, and a blank sidebar
  // would read as a broken app rather than as a permissions problem.
  if (modules.length === 0) {
    return (
      <SidebarGroup>
        <p className="px-2 py-1.5 text-xs leading-relaxed text-sidebar-foreground/70 group-data-[collapsible=icon]:sr-only">
          Nenhum módulo liberado para o seu perfil. Fale com um administrador.
        </p>
      </SidebarGroup>
    )
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Módulos</SidebarGroupLabel>

      <SidebarGroupContent>
        <SidebarMenu>
          {modules.map((module) => {
            const Icon = moduleIcon(module.icon)
            // Longest-prefix semantics, same as the registry's route guard: /empresas/<id>
            // keeps "Empresas" lit.
            const active = pathname === module.route || pathname.startsWith(`${module.route}/`)

            return (
              <SidebarMenuItem key={module.id}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={module.name}
                  // Selection is signalled by CONTRAST, not by hue: the resting items step
                  // back to 65% ink so the active one (semibold, 100% — see ui/sidebar.tsx)
                  // reads as the selected one. 65% is the floor that still clears WCAG 4.5:1
                  // against the sidebar surface in BOTH themes (5.3:1 light, 6.5:1 dark);
                  // dimming further would make the unselected modules fail as text.
                  //
                  // Applied here rather than in the button's variants because that component
                  // also renders the brand header and the user menu, which are not navigation
                  // and must not be dimmed.
                  className={active ? undefined : 'text-sidebar-foreground/65'}
                >
                  <Link href={module.route} aria-current={active ? 'page' : undefined}>
                    <Icon />
                    <span>{module.name}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
