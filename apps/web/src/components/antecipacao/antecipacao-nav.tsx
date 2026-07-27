'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Building2,
  ChartPie,
  Inbox,
  KanbanSquare,
  MessageCircle,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Navegação interna do módulo. O registry dá o item de sidebar de primeiro nível;
 * este layout liga as telas.
 *
 * O que é admin-only aqui é o que mexe na RÉGUA (faixas, disparos, contas,
 * settings): mudar uma regra de faixa reclassifica o funil de todo mundo. Ver o
 * funil, os sacados e a outbox é para todo o time.
 */

interface ItemNav {
  href: string
  label: string
  icon: typeof KanbanSquare
  somenteAdmin?: boolean
}

const ITENS: readonly ItemNav[] = [
  { href: '/antecipacao', label: 'Funil', icon: KanbanSquare },
  { href: '/antecipacao/sacados', label: 'Por sacado', icon: Building2 },
  { href: '/antecipacao/prospectar', label: 'Sacados a prospectar', icon: Sparkles },
  { href: '/antecipacao/metricas', label: 'Métricas por faixa', icon: ChartPie },
  { href: '/antecipacao/faixas', label: 'Regras de faixa', icon: SlidersHorizontal, somenteAdmin: true },
  { href: '/antecipacao/disparos', label: 'Disparos', icon: Send, somenteAdmin: true },
  { href: '/antecipacao/outbox', label: 'Outbox', icon: Inbox },
  { href: '/antecipacao/whatsapp', label: 'Contas WhatsApp', icon: MessageCircle, somenteAdmin: true },
  { href: '/antecipacao/config', label: 'Configurações', icon: Settings, somenteAdmin: true },
]

export function AntecipacaoNav({ ehAdmin }: { ehAdmin: boolean }) {
  const pathname = usePathname()
  const itens = ITENS.filter((i) => !i.somenteAdmin || ehAdmin)

  return (
    <nav
      aria-label="Seções da Antecipação"
      className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px"
    >
      {itens.map((item) => {
        const ativo =
          item.href === '/antecipacao' ? pathname === '/antecipacao' : pathname.startsWith(item.href)
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
