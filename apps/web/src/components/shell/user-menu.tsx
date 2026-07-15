'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { ChevronsUpDown, Laptop, LogOut, Moon, Settings, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'

export interface ShellUsuario {
  id: string
  nome: string
  email: string
}

interface UserMenuProps {
  usuario: ShellUsuario
}

/**
 * The sidebar footer: who you are, and the three things you can do about it — theme,
 * settings, sign out.
 *
 * Rendered as a SidebarMenuButton so it collapses with everything else: on the icon rail
 * the avatar is all that is left, and it is still the same button opening the same menu.
 */
export function UserMenu({ usuario }: UserMenuProps) {
  const router = useRouter()
  const { isMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const [signingOut, setSigningOut] = React.useState(false)

  // next-themes only knows the resolved theme after mount (it reads localStorage /
  // the media query in an effect). Rendering the checked radio before that would make
  // the server markup disagree with the client's.
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const signOut = React.useCallback(async () => {
    setSigningOut(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()

    if (error) {
      setSigningOut(false)
      toast.error('Não foi possível sair. Tente novamente.')
      return
    }

    // replace(), not push(): the app must not be reachable with the back button after a
    // logout. refresh() drops the RSC cache, so no server-rendered page keeps the old
    // session's data around.
    router.replace('/login')
    router.refresh()
  }, [router])

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={signingOut}>
            <SidebarMenuButton
              size="lg"
              aria-label="Menu do usuário"
              tooltip={usuario.nome}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 shrink-0 rounded-lg">
                <AvatarFallback className="rounded-lg bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground">
                  {initials(usuario.nome)}
                </AvatarFallback>
              </Avatar>

              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{usuario.nome}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">{usuario.email}</span>
              </span>

              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          {/* The menu opens sideways out of the rail on desktop, and upward from the
              drawer's footer on mobile, where there is no room to its right. */}
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? 'top' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium">{usuario.nome}</span>
              <span className="block truncate text-xs text-muted-foreground">{usuario.email}</span>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Tema
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={mounted ? (theme ?? 'system') : 'system'}
              onValueChange={setTheme}
            >
              <DropdownMenuRadioItem value="light">
                <Sun className="mr-2 h-4 w-4" />
                Claro
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon className="mr-2 h-4 w-4" />
                Escuro
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Laptop className="mr-2 h-4 w-4" />
                Sistema
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />

            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="mr-2 h-4 w-4" />
                Configurações
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem
              onSelect={(event) => {
                // Keep the menu mounted while the request is in flight, so the disabled
                // state is visible and a double-click cannot fire two sign-outs.
                event.preventDefault()
                void signOut()
              }}
              disabled={signingOut}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              {signingOut ? 'Saindo…' : 'Sair'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function initials(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]
  if (!first) return '?'

  const last = parts.length > 1 ? parts[parts.length - 1] : undefined
  if (!last) return first.slice(0, 2).toUpperCase()

  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
}
