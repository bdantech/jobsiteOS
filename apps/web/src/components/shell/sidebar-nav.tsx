'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { grantedModuleGroups } from '@jobsiteos/core'
import { moduleIcon } from '@/components/shell/icons'
import { cn } from '@/lib/utils'
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
 *
 * As seções (Inteligência / Operações / Outros) também vêm do registry: cada módulo
 * declara o `group` dele e `grantedModuleGroups()` monta as seções na ordem canônica,
 * omitindo as que ficariam vazias para este perfil.
 */
export function SidebarNav({ grantedModuleIds }: SidebarNavProps) {
  const pathname = usePathname()
  const groups = grantedModuleGroups(grantedModuleIds)

  // Empty state. A perfil with no modules is a misconfiguration, and a blank sidebar
  // would read as a broken app rather than as a permissions problem.
  if (groups.length === 0) {
    return (
      <SidebarGroup>
        <p className="px-2 py-1.5 text-xs leading-relaxed text-sidebar-foreground/70 group-data-[collapsible=icon]:sr-only">
          Nenhum módulo liberado para o seu perfil. Fale com um administrador.
        </p>
      </SidebarGroup>
    )
  }

  return (
    <>
      {groups.map((group, i) => (
        /*
         * O AR SEPARA AS SEÇÕES, E SÓ ELAS.
         *
         * O default do componente gastava 24px entre duas seções — 8 do fim de um
         * grupo, 8 do `gap` do conteúdo, 8 do começo do próximo — e isso empurrava os
         * últimos módulos para fora da dobra em telas de notebook. `py-1` cortou para
         * 8px e foi longe demais na direção oposta: a separação entre "Inteligência" e
         * "Operações" ficou quase indistinguível da separação entre dois itens da
         * mesma seção, e o rótulo passou a parecer mais um item da lista.
         *
         * O ar que corrige isso é MARGEM ENTRE GRUPOS, não padding dentro deles.
         * Engordar o `py` também afasta o rótulo dos próprios itens e solta o último
         * item da seção — o grupo inteiro fica mais frouxo, e a distância que cresce
         * não é só a que se queria crescer. `mt-2` no grupo põe os 8px exatamente na
         * junta: 16px entre seções (4 do fim de um grupo + 8 + 4 do começo do outro)
         * contra os mesmos 2px de sempre entre dois itens.
         *
         * `i > 0` em vez de `first:` porque o seletor depende da posição no DOM, e
         * este componente é renderizado dentro de containers que podem ter irmãos
         * antes dele — o primeiro grupo ganharia uma margem que ninguém pediu.
         *
         * O que NÃO muda é a altura do botão (`h-8`): ela é o alvo do clique, e mexer
         * em alvo de clique para ganhar pixel é a troca errada.
         */
        <SidebarGroup key={group.id} className={cn('px-2 py-1', i > 0 && 'mt-2')}>
          {/* 24px em vez de 32: o rótulo da seção é uma legenda, não um item. */}
          <SidebarGroupLabel className="h-6">{group.label}</SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {group.modules.map((module) => {
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
      ))}
    </>
  )
}
