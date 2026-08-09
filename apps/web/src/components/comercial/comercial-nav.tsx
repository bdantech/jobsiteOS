'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, Coins, Inbox, LayoutDashboard, Settings, Target, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Navegação do Comercial. Ao contrário dos outros módulos, o que aparece aqui depende
 * do TIPO do vendedor logado: um SDR não tem funil de vendas, e um originador não tem
 * funil de reuniões. Mostrar as duas abas vazias para os dois seria uma tela que
 * ensina errado sobre o próprio trabalho.
 *
 * Gestor (Admin/Comercial) vê tudo — é ele quem atribui a fila e aprova a comissão.
 */

interface ItemNav {
  href: string
  label: string
  icon: typeof Target
  /** Tipos de vendedor para quem o item faz sentido. Vazio = todos. */
  tipos?: readonly string[]
  somenteGestor?: boolean
}

const ITENS: readonly ItemNav[] = [
  { href: '/comercial', label: 'Meu Painel', icon: LayoutDashboard },
  { href: '/comercial/sdr', label: 'Reuniões', icon: Target, tipos: ['sdr'] },
  { href: '/comercial/vendas', label: 'Funil de vendas', icon: Users, tipos: ['vendedor'] },
  { href: '/comercial/fila', label: 'Fila sem dono', icon: Inbox, somenteGestor: true },
  { href: '/comercial/calendario', label: 'Calendário', icon: CalendarDays, tipos: ['sdr', 'vendedor'] },
  { href: '/comercial/comissoes', label: 'Comissões', icon: Coins },
  { href: '/comercial/admin', label: 'Configurações', icon: Settings, somenteGestor: true },
]

export function ComercialNav({ tipo, ehGestor }: { tipo: string | null; ehGestor: boolean }) {
  const pathname = usePathname()
  const itens = ITENS.filter((i) => {
    if (i.somenteGestor && !ehGestor) return false
    if (!i.tipos) return true
    // Gestor enxerga os dois funis mesmo sem ser vendedor de nenhum tipo.
    return ehGestor || (tipo !== null && i.tipos.includes(tipo))
  })

  return (
    <nav aria-label="Seções do Comercial" className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px">
      {itens.map((item) => {
        const ativo = item.href === '/comercial' ? pathname === '/comercial' : pathname.startsWith(item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors',
              ativo
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
