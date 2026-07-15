'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Shield, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

const ABAS = [
  { href: '/admin/usuarios', label: 'Usuários', icon: Users },
  { href: '/admin/perfis', label: 'Perfis', icon: Shield },
] as const

/**
 * Tab-styled links rather than <Tabs>: each tab is a distinct route, so it must
 * be a real navigation (shareable URL, back button, RSC streaming) and not
 * client-side panel switching.
 */
export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Seções da administração"
      className="flex items-center gap-1 border-b border-border"
    >
      {ABAS.map((aba) => {
        const ativa = pathname === aba.href || pathname.startsWith(`${aba.href}/`)
        const Icon = aba.icon

        return (
          <Link
            key={aba.href}
            href={aba.href}
            aria-current={ativa ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              ativa
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {aba.label}
          </Link>
        )
      })}
    </nav>
  )
}
