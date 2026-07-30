'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Ban, LayoutDashboard, Layers, Settings, Sigma } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Navegação interna do módulo Radar. O registry dá o item de sidebar de primeiro
 * nível; este layout liga as telas do módulo. Config é admin-only.
 */

interface ItemNav {
  href: string
  label: string
  icon: typeof Layers
  somenteAdmin?: boolean
}

// Clientes Onepay saiu daqui: agora vive no menu Empresas (aba Clientes Onepay).
const ITENS: readonly ItemNav[] = [
  { href: '/radar', label: 'Painel', icon: LayoutDashboard },
  { href: '/radar/lotes', label: 'Lotes', icon: Layers },
  { href: '/radar/supressao', label: 'Supressão', icon: Ban },
  { href: '/radar/estimador', label: 'Estimador', icon: Sigma },
  { href: '/radar/config', label: 'Configurações', icon: Settings, somenteAdmin: true },
]

export function RadarNav({ ehAdmin }: { ehAdmin: boolean }) {
  const pathname = usePathname()
  const itens = ITENS.filter((i) => !i.somenteAdmin || ehAdmin)

  return (
    <nav aria-label="Seções do Radar" className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px">
      {itens.map((item) => {
        const ativo = item.href === '/radar' ? pathname === '/radar' : pathname.startsWith(item.href)
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
