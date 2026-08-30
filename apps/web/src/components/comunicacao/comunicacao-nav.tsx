'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Bot, FileText, Inbox, Link2Off, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Navegação interna da Comunicação. Mesmo padrão do Jurídico, do Crédito e do Radar. */
const ITENS = [
  { href: '/comunicacao', label: 'Inbox', icon: Inbox },
  { href: '/comunicacao/nao-vinculadas', label: 'Não vinculadas', icon: Link2Off },
  { href: '/comunicacao/templates', label: 'Templates', icon: FileText },
  { href: '/comunicacao/playbooks', label: 'Playbooks', icon: Bot },
  { href: '/comunicacao/atividade', label: 'Atividade', icon: BarChart3 },
  { href: '/comunicacao/config', label: 'Configurações', icon: Settings },
] as const

export function ComunicacaoNav() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Seções da Comunicação"
      className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px"
    >
      {ITENS.map((item) => {
        const ativo =
          item.href === '/comunicacao' ? pathname === '/comunicacao' : pathname.startsWith(item.href)
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
