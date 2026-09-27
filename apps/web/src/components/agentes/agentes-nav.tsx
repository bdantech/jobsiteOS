'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, BarChart3, Bot, FileStack, KanbanSquare, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Navegação interna dos Agentes (§ Localização do Prompt 09). Ao vivo vem primeiro: é a
 * tela que se deixa aberta num monitor.
 */
const ITENS = [
  { href: '/agentes', label: 'Ao vivo', icon: Activity },
  { href: '/agentes/mandatos', label: 'Mandatos', icon: KanbanSquare },
  { href: '/agentes/personas', label: 'Personas', icon: Bot },
  { href: '/agentes/materiais', label: 'Materiais', icon: FileStack },
  { href: '/agentes/desempenho', label: 'Desempenho', icon: BarChart3 },
  { href: '/agentes/config', label: 'Configurações', icon: Settings },
] as const

export function AgentesNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Seções dos Agentes" className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px">
      {ITENS.map((item) => {
        const ativo = item.href === '/agentes' ? pathname === '/agentes' : pathname.startsWith(item.href)
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
