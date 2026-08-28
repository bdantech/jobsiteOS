'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarClock, Gavel, LayoutDashboard, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Navegação interna do módulo Jurídico. Mesmo padrão do Crédito e do Radar. */
const ITENS = [
  { href: '/juridico', label: 'Processos', icon: Gavel },
  // Painel depois da lista: quem abre o Jurídico de manhã abre para trabalhar os
  // processos, não para olhar o agregado.
  { href: '/juridico/painel', label: 'Painel', icon: LayoutDashboard },
  { href: '/juridico/prazos', label: 'Prazos', icon: CalendarClock },
  { href: '/juridico/config', label: 'Configurações', icon: Settings },
] as const

export function JuridicoNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Seções do Jurídico" className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px">
      {ITENS.map((item) => {
        const ativo = item.href === '/juridico' ? pathname === '/juridico' : pathname.startsWith(item.href)
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
