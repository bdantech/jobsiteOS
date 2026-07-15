'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Circle, Compass, FileSpreadsheet, Layers, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Navegação interna do módulo Mercado.
 *
 * O registry dirige a navegação de PRIMEIRO nível: um item de sidebar por módulo.
 * Isso bastou para `empresas`, que não tem sub-páginas. O Mercado tem sete, e sem
 * isto quatro delas (Explorador, Segmentos, Importações, Grupos) eram inalcançáveis
 * clicando — existiam, funcionavam, e só respondiam a quem digitasse a URL.
 *
 * Grupos fica DE FORA de propósito: não existe `/mercado/grupos` (só
 * `/mercado/grupos/[id]`). Um grupo econômico se alcança a partir de uma empresa
 * ou do Explorador, nunca de uma lista solta — a pergunta "quais são todos os
 * grupos?" não é uma que alguém faça.
 */

interface ItemNav {
  href: string
  label: string
  icon: typeof Compass
  /** Camadas redireciona não-admins para /sem-acesso: não a ofereça a eles. */
  somenteAdmin?: boolean
}

const ITENS: readonly ItemNav[] = [
  { href: '/mercado', label: 'Mapa', icon: BarChart3 },
  { href: '/mercado/explorador', label: 'Explorador', icon: Compass },
  { href: '/mercado/segmentos', label: 'Segmentos', icon: Layers },
  { href: '/mercado/importacoes', label: 'Importações', icon: FileSpreadsheet },
  { href: '/mercado/ingestoes', label: 'Ingestões', icon: Radio },
  // A rota continua /mercado/piramide de propósito: o rótulo mudou, a URL não —
  // links salvos e abas abertas continuam válidos.
  { href: '/mercado/piramide', label: 'Camadas', icon: Circle, somenteAdmin: true },
]

interface MercadoNavProps {
  ehAdmin: boolean
}

export function MercadoNav({ ehAdmin }: MercadoNavProps) {
  const pathname = usePathname()

  const itens = ITENS.filter((item) => !item.somenteAdmin || ehAdmin)

  return (
    <nav
      aria-label="Seções do Mercado"
      className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px"
    >
      {itens.map((item) => {
        // O Mapa é a raiz do módulo: sem o teste exato ele ficaria "ativo" em
        // todas as sub-rotas, porque toda uma delas começa com /mercado.
        const ativo =
          item.href === '/mercado'
            ? pathname === '/mercado'
            : pathname === item.href || pathname.startsWith(`${item.href}/`)

        const Icon = item.icon

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={ativo ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              ativo
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
