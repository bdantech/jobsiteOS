'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Building2,
  ChartPie,
  Factory,
  HandCoins,
  KanbanSquare,
  Settings,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Navegação interna do módulo. O registry dá o item de sidebar de primeiro nível;
 * este layout liga as telas.
 *
 * O que é admin-only aqui é o que mexe na RÉGUA (faixas, settings): mudar uma
 * regra de faixa reclassifica o funil de todo mundo. Ver o funil e os sacados é
 * para todo o time.
 */

interface ItemNav {
  href: string
  label: string
  icon: typeof KanbanSquare
  somenteAdmin?: boolean
}

const ITENS: readonly ItemNav[] = [
  { href: '/antecipacao', label: 'Funil', icon: KanbanSquare },
  { href: '/antecipacao/sacados', label: 'Por Sacado', icon: Building2 },
  { href: '/antecipacao/prospectar', label: 'Sacados a Prospectar', icon: Sparkles },
  // Ao lado da irmã de propósito: são a mesma pergunta pelos dois lados da nota —
  // quem RECEBE e não é nosso, quem EMITE para quem já é.
  { href: '/antecipacao/prospectar-fornecedores', label: 'Fornecedores a Prospectar', icon: Factory },
  { href: '/antecipacao/antecipacoes', label: 'Antecipações', icon: HandCoins },
  { href: '/antecipacao/metricas', label: 'Métricas', icon: ChartPie },
  { href: '/antecipacao/faixas', label: 'Regras de Faixa', icon: SlidersHorizontal, somenteAdmin: true },
  // Disparos, Outbox e Contas WhatsApp mudaram para o menu da Comunicação. A
  // régua continua sendo desta casa — o que mudou é onde se olha para ela.
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
        // O casamento é por SEGMENTO, não por prefixo de string. Com `startsWith`
        // cru, `/antecipacao/prospectar-fornecedores` acendia também a aba
        // `/antecipacao/prospectar` — duas abas ativas ao mesmo tempo. A barra no
        // fim é o que separa "rota filha" de "rota com nome parecido"; as fichas
        // (`/sacados/[cnpj]`) continuam acendendo a aba pai como antes.
        const ativo =
          item.href === '/antecipacao'
            ? pathname === '/antecipacao'
            : pathname === item.href || pathname.startsWith(`${item.href}/`)
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
