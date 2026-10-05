'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Pin, PinOff } from 'lucide-react'
import { grantedModuleGroups } from '@jobsiteos/core'
import { moduleIcon } from '@/components/shell/icons'
import { resolverAtalho, type Atalho } from '@/components/shell/abas-dos-modulos'
import { useAtalhos } from '@/components/shell/atalhos-provider'
import { cn } from '@/lib/utils'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
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
 * As seções também vêm do registry: cada módulo declara o `group` dele e
 * `grantedModuleGroups()` monta as seções na ordem canônica, omitindo as que ficariam
 * vazias para este perfil. Acima delas vem "Fixados" — os módulos e abas que a PESSOA
 * escolheu (0284), na ordem dela.
 */
export function SidebarNav({ grantedModuleIds }: SidebarNavProps) {
  const pathname = usePathname()
  const groups = grantedModuleGroups(grantedModuleIds)
  const { fixados, visao, estaFixado, alternar } = useAtalhos()

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

  const atalhos = fixados
    .map((href) => resolverAtalho(href, visao))
    .filter((a): a is Atalho => a !== null)

  // Dois "Painel" fixados (do Crédito e do Jurídico) seriam dois itens iguais. Só nesse
  // caso o rótulo ganha o módulo — no resto, o nome curto é o que cabe na largura.
  const repetidos = new Set(
    atalhos.map((a) => a.label).filter((l, i, todos) => todos.indexOf(l) !== i),
  )

  return (
    <>
      {atalhos.length > 0 && (
        <SidebarGroup className="px-2 py-1">
          <SidebarGroupLabel className="h-6">Fixados</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {atalhos.map((atalho) => {
                const Icon = atalho.icon
                const label = repetidos.has(atalho.label)
                  ? `${atalho.label} · ${atalho.moduloNome}`
                  : atalho.label
                // Caminho com query (`/empresas?tab=clientes`) não acende: o pathname não
                // carrega a query, e ler `useSearchParams` aqui faria toda página estática
                // perder o pré-render só por causa da sidebar.
                const active =
                  !atalho.href.includes('?') &&
                  (pathname === atalho.href || pathname.startsWith(`${atalho.href}/`))
                return (
                  <SidebarMenuItem key={atalho.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={atalho.ehModulo ? label : `${atalho.moduloNome} › ${atalho.label}`}
                      className={active ? undefined : 'text-sidebar-foreground/65'}
                    >
                      <Link href={atalho.href} aria-current={active ? 'page' : undefined}>
                        <Icon />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover
                      onClick={() => alternar(atalho.href)}
                      aria-label={`Desafixar ${label}`}
                      title="Desafixar"
                    >
                      <PinOff aria-hidden />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {groups.map((group, i) => (
        /*
         * O AR SEPARA AS SEÇÕES, E SÓ ELAS.
         *
         * O default do componente gastava 24px entre duas seções — 8 do fim de um
         * grupo, 8 do `gap` do conteúdo, 8 do começo do próximo — e isso empurrava os
         * últimos módulos para fora da dobra em telas de notebook. `py-1` cortou para
         * 8px e foi longe demais na direção oposta: a separação entre duas seções ficou
         * quase indistinguível da separação entre dois itens da mesma seção, e o rótulo
         * passou a parecer mais um item da lista.
         *
         * O ar que corrige isso é MARGEM ENTRE GRUPOS, não padding dentro deles.
         * Engordar o `py` também afasta o rótulo dos próprios itens e solta o último
         * item da seção — o grupo inteiro fica mais frouxo, e a distância que cresce
         * não é só a que se queria crescer. `mt-2` no grupo põe os 8px exatamente na
         * junta: 16px entre seções (4 do fim de um grupo + 8 + 4 do começo do outro)
         * contra os mesmos 2px de sempre entre dois itens.
         *
         * `i > 0 || atalhos.length > 0` em vez de `first:` porque o seletor depende da
         * posição no DOM, e este componente é renderizado dentro de containers que podem
         * ter irmãos antes dele — o primeiro grupo ganharia uma margem que ninguém pediu.
         *
         * O que NÃO muda é a altura do botão (`h-8`): ela é o alvo do clique, e mexer
         * em alvo de clique para ganhar pixel é a troca errada.
         */
        <SidebarGroup
          key={group.id}
          className={cn('px-2 py-1', (i > 0 || atalhos.length > 0) && 'mt-2')}
        >
          {/* 24px em vez de 32: o rótulo da seção é uma legenda, não um item. A seção
              sem rótulo (Empresas) não ganha cabeçalho vazio. */}
          {group.label && <SidebarGroupLabel className="h-6">{group.label}</SidebarGroupLabel>}

          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {group.modules.map((module) => {
                const Icon = moduleIcon(module.icon)
                // Longest-prefix semantics, same as the registry's route guard: /empresas/<id>
                // keeps "Empresas" lit.
                const active = pathname === module.route || pathname.startsWith(`${module.route}/`)
                const fixado = estaFixado(module.route)

                /*
                 * Selection is signalled by CONTRAST, not by hue: the resting items step
                 * back to 65% ink so the active one (semibold, 100% — see ui/sidebar.tsx)
                 * reads as the selected one. 65% is the floor that still clears WCAG 4.5:1
                 * against the sidebar surface in BOTH themes (5.3:1 light, 6.5:1 dark);
                 * dimming further would make the unselected modules fail as text.
                 *
                 * A exceção é a seção sem rótulo (Empresas): ela fica na cor primária do
                 * sistema, ativa ou não. Sem cabeçalho, é a cor que a separa das seções
                 * de baixo e diz "este é o cadastro de todos". O ativo continua se
                 * distinguindo pelo peso (semibold) e pelo aria-current.
                 *
                 * Applied here rather than in the button's variants because that component
                 * also renders the brand header and the user menu, which are not navigation
                 * and must not be dimmed.
                 */
                const cor =
                  group.label === null
                    ? 'text-primary hover:text-primary'
                    : active
                      ? undefined
                      : 'text-sidebar-foreground/65'

                return (
                  <SidebarMenuItem key={module.id}>
                    <SidebarMenuButton asChild isActive={active} tooltip={module.name} className={cor}>
                      <Link href={module.route} aria-current={active ? 'page' : undefined}>
                        <Icon />
                        <span>{module.name}</span>
                      </Link>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover
                      onClick={() => alternar(module.route)}
                      aria-label={fixado ? `Desafixar ${module.name}` : `Fixar ${module.name} no topo`}
                      title={fixado ? 'Desafixar' : 'Fixar no topo'}
                    >
                      {fixado ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                    </SidebarMenuAction>
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
