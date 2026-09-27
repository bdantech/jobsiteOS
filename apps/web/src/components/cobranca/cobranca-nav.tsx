'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileText, Gauge, Landmark, Settings, ShieldAlert, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Navegação interna da Cobrança (§ Localização do Prompt 07). O Painel vem primeiro
 * porque é nele que mora o relógio da apólice — a primeira coisa que o gestor vê.
 */
const ITENS = [
  { href: '/cobranca', label: 'Painel', icon: Gauge },
  { href: '/cobranca/cobrancas', label: 'Cobranças', icon: Wallet },
  { href: '/cobranca/sinistros', label: 'Sinistros', icon: ShieldAlert },
  { href: '/cobranca/protestos', label: 'Protestos', icon: Landmark },
  { href: '/cobranca/modelos', label: 'Modelos', icon: FileText },
  { href: '/cobranca/config', label: 'Configurações', icon: Settings },
] as const

export function CobrancaNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Seções da Cobrança" className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px">
      {ITENS.map((item) => {
        const ativo =
          item.href === '/cobranca'
            ? pathname === '/cobranca'
            : item.href === '/cobranca/cobrancas'
              ? pathname.startsWith('/cobranca/cobrancas') || pathname.startsWith('/cobranca/nova')
              : pathname.startsWith(item.href)
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
