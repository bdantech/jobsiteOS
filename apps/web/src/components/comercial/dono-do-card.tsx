'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ExternalLink, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { buscarVendedores, comercialKeys } from './queries'

/**
 * De quem é este card — em todos os funis do Comercial.
 *
 * Só aparece quando a lista NÃO está filtrada por vendedor: com o filtro ligado, o
 * nome se repetiria em cada card dizendo o que o filtro no topo já diz, e repetir
 * informação constante é o jeito mais barato de tirar espaço do que varia.
 *
 * ─── QUEM TROCA ─────────────────────────────────────────────────────────────
 * Só gestor, seguindo `app_atribuir_nf` (0091). Um vendedor que pudesse se atribuir
 * cards transformaria a fila num self-service, e a distribuição — que é o que o
 * Comercial usa para equilibrar carga e território — deixaria de significar algo.
 * Quem não é gestor vê o nome como texto.
 *
 * ─── POR QUE ALGUNS CARDS SÓ MOSTRAM ────────────────────────────────────────
 * No funil de certificados o dono não é do card: vem de `vendedor_carteira`. Trocar
 * ali não seria editar um card, seria mover a empresa de carteira — levando junto o
 * roteamento das NFs e a comissão dela. Nesse caso o componente vira um link para a
 * tela de Carteira, onde a decisão tem o contexto que exige.
 */

export type TipoDono = 'sdr' | 'vendedor' | 'originador'

interface Props {
  /** Nome exibido. `null` = sem dono, e isso aparece como "sem dono" em âmbar. */
  nome: string | null
  /** Tipos de vendedor oferecidos no dropdown. */
  tipos: readonly TipoDono[]
  podeTrocar: boolean
  onTrocar?: (vendedorId: string) => void | Promise<void>
  /** Quando presente, o componente vira link em vez de dropdown (certificados). */
  href?: string
  ocupado?: boolean
  className?: string
}

export function DonoDoCard({ nome, tipos, podeTrocar, onTrocar, href, ocupado, className }: Props) {
  const [aberto, setAberto] = React.useState(false)
  const vendedores = useQuery({
    queryKey: comercialKeys.vendedores(),
    queryFn: buscarVendedores,
    // Só busca quando alguém realmente abre o dropdown: são até dezenas de cards na
    // tela, e todos compartilham esta mesma chave de cache.
    enabled: aberto,
    staleTime: 5 * 60_000,
  })

  const rotulo = nome ?? 'sem dono'
  const semDono = nome === null

  const conteudo = (
    <span className={cn('flex min-w-0 items-center gap-1 text-[11px]', semDono && 'text-amber-700 dark:text-amber-400')}>
      <UserRound className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{rotulo}</span>
    </span>
  )

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          'flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          className,
        )}
        title="Ver na Carteira — a troca acontece lá, porque move as NFs e a comissão junto"
      >
        {conteudo}
        <ExternalLink className="h-2.5 w-2.5 shrink-0" aria-hidden />
      </Link>
    )
  }

  if (!podeTrocar) {
    return <span className={cn('flex max-w-full px-1 text-muted-foreground', className)}>{conteudo}</span>
  }

  const opcoes = (vendedores.data ?? []).filter((v) => v.ativo && tipos.includes(v.tipo as TipoDono))

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={ocupado}
          className={cn(
            'flex max-w-full items-center gap-0.5 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50',
            className,
          )}
          aria-label={`Dono: ${rotulo}. Clique para trocar.`}
        >
          {conteudo}
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {vendedores.isPending ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">Carregando…</p>
        ) : opcoes.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            Nenhum vendedor deste tipo cadastrado.
          </p>
        ) : (
          <ul className="max-h-64 overflow-y-auto">
            {opcoes.map((v) => (
              <li key={v.id}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn('h-8 w-full justify-start text-xs', v.nome === nome && 'bg-accent font-medium')}
                  onClick={() => {
                    setAberto(false)
                    void onTrocar?.(v.id)
                  }}
                >
                  {v.nome}
                  <span className="ml-auto text-[10px] text-muted-foreground">{v.tipo}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
