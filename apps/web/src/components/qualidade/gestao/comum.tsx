'use client'

import * as React from 'react'
import { paletaCategorica } from '@jobsiteos/core'
import { STATUS_SUPERFICIE } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Peças pequenas que as seis abas repetem: o estado de erro, o vazio, a paleta dos
 * gráficos e a dica do tooltip.
 */

/** O erro da RPC chega em pt-BR; mostrá-lo é melhor que uma aba em branco. */
export function ErroCarga({ erro, oque }: { erro: unknown; oque: string }) {
  const msg = erro instanceof Error ? erro.message : String(erro ?? '')
  return (
    <div className={cn('rounded-lg border p-4 text-sm', STATUS_SUPERFICIE.critical)}>
      Não foi possível carregar {oque}{msg ? `: ${msg}` : '.'}
    </div>
  )
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
}

/**
 * A paleta categórica validada do core (a mesma do Meu Dia e dos Relatórios), com os
 * passos PRÓPRIOS do escuro — não uma inversão do claro. Humano é sempre o slot 0 e IA
 * o slot 1, em todo gráfico desta tela: a cor segue a entidade, nunca a posição.
 */
export function usePaleta(): string[] {
  const [escuro, setEscuro] = React.useState(false)
  React.useEffect(() => {
    const raiz = document.documentElement
    const ler = () =>
      setEscuro(
        raiz.dataset.theme === 'dark' ||
          raiz.classList.contains('dark') ||
          (raiz.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches),
      )
    ler()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', ler)
    const obs = new MutationObserver(ler)
    obs.observe(raiz, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => {
      mq.removeEventListener('change', ler)
      obs.disconnect()
    }
  }, [])
  return paletaCategorica(escuro)
}

export function Dica({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">{children}</div>
}

/** Amostra de cor ao lado de um rótulo de texto: a cor marca a série, o texto fica na tinta. */
export function Amostra({ cor }: { cor: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: cor }} />
}

/** Bloco de aviso com o canal de status (nunca só cor: sempre com texto). */
export function Aviso({
  tom = 'warning',
  children,
  className,
}: {
  tom?: keyof typeof STATUS_SUPERFICIE
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('rounded-md border p-3 text-sm', STATUS_SUPERFICIE[tom], className)}>{children}</div>
}
