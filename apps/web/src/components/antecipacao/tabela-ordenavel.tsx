'use client'

import * as React from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * Cabeçalho ordenável e a preferência que sobrevive à visita — o que as tabelas do
 * módulo compartilham.
 *
 * Vive aqui, e não em cada tela, porque "clicou no cabeçalho, ordenou" tem de se
 * comportar igual em toda a Antecipação: a mesma seta, o mesmo primeiro clique, a
 * mesma persistência. Duas implementações viram duas convenções em uma semana.
 */

export type Direcao = 'asc' | 'desc'

export interface Ordenacao<C extends string> {
  coluna: C
  dir: Direcao
}

/** Mesma coluna inverte; coluna nova começa na direção que interessa. */
export function proximaOrdenacao<C extends string>(
  atual: Ordenacao<C>,
  coluna: C,
  primeiraDirecao: Record<C, Direcao>,
): Ordenacao<C> {
  if (atual.coluna === coluna) return { coluna, dir: atual.dir === 'asc' ? 'desc' : 'asc' }
  return { coluna, dir: primeiraDirecao[coluna] }
}

interface CabecalhoProps<C extends string> {
  coluna: C
  ativa: C
  dir: Direcao
  onClick: (coluna: C) => void
  className?: string
  title?: string
  children: React.ReactNode
}

/**
 * O ícone da coluna inativa fica invisível até o hover. Sete setas acesas ao mesmo
 * tempo escondem qual é a ordem em vigor — que é a única informação que o cabeçalho
 * precisa passar de relance.
 */
export function CabecalhoOrdenavel<C extends string>({
  coluna,
  ativa,
  dir,
  onClick,
  className,
  title,
  children,
}: CabecalhoProps<C>) {
  const eAtiva = ativa === coluna
  const Icone = !eAtiva ? ChevronsUpDown : dir === 'asc' ? ArrowUp : ArrowDown

  return (
    <TableHead
      className={cn('p-0', className)}
      aria-sort={eAtiva ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onClick(coluna)}
        title={title}
        className={cn(
          'group inline-flex h-12 w-full items-center gap-1 whitespace-nowrap px-4 font-medium transition-colors hover:text-foreground',
          className?.includes('text-right') && 'justify-end',
          eAtiva && 'text-foreground',
        )}
      >
        {children}
        <Icone
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-opacity',
            eAtiva ? 'opacity-100' : 'opacity-0 group-hover:opacity-60',
          )}
          aria-hidden
        />
      </button>
    </TableHead>
  )
}

/**
 * Preferência de tabela persistida no navegador.
 *
 * O estado inicial é SEMPRE o padrão, nunca o storage: ler no render divergiria do
 * HTML do servidor e quebraria a hidratação. A leitura acontece no efeito.
 *
 * `sanear` é obrigatório e não é cerimônia — localStorage é editável pelo usuário e
 * sobrevive a refatoração. Uma coluna que saiu do catálogo viraria um `sort` por
 * campo inexistente: tabela em ordem aleatória, nenhum erro na tela.
 */
export function usePreferenciasTabela<T extends object>(
  chave: string,
  padrao: T,
  sanear: (bruto: Record<string, unknown>) => T,
) {
  const [prefs, setPrefs] = React.useState<T>(padrao)

  React.useEffect(() => {
    try {
      const bruto = window.localStorage.getItem(chave)
      if (!bruto) return
      const p: unknown = JSON.parse(bruto)
      if (typeof p === 'object' && p !== null) setPrefs(sanear(p as Record<string, unknown>))
    } catch {
      // Storage bloqueado (aba anônima, política de cookies) é "sem preferência
      // salva", não página quebrada.
    }
    // Só na montagem: `sanear` costuma ser função inline e reexecutar a cada render
    // sobrescreveria o que a pessoa acabou de escolher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  const atualizar = React.useCallback(
    (mudanca: Partial<T>) => {
      setPrefs((atuais) => {
        const proximas = { ...atuais, ...mudanca }
        try {
          window.localStorage.setItem(chave, JSON.stringify(proximas))
        } catch {
          /* sem persistência: a sessão atual continua funcionando */
        }
        return proximas
      })
    },
    [chave],
  )

  return { prefs, atualizar }
}
