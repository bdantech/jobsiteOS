'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Settings, SlidersHorizontal, Workflow } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Navegação interna do módulo Crédito. Mesmo padrão do Radar. */
const ITENS = [
  { href: '/credito', label: 'Esteira', icon: Workflow },
  { href: '/credito/painel', label: 'Painel', icon: LayoutDashboard },
  { href: '/credito/scorecard', label: 'Scorecard', icon: SlidersHorizontal },
  { href: '/credito/config', label: 'Configurações', icon: Settings },
] as const

export function CreditoNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Seções do Crédito" className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px">
      {ITENS.map((item) => {
        const ativo = item.href === '/credito' ? pathname === '/credito' : pathname.startsWith(item.href)
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
