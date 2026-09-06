'use client'

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink, MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { blocoCatalogado, ordenarItens, type BlocoMeuDia, type ItemMeuDia } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * A moldura de um widget: título, um número de contexto, o conteúdo, e o rodapé com o
 * "ver todos". Altura previsível, para a grade não dançar quando um bloco cresce.
 */
export function Widget({
  titulo, descricao, contexto, filtro, children, rodape, className,
}: {
  titulo: string
  descricao?: string
  contexto?: React.ReactNode
  /** Controle que recorta o conteúdo. Fica no cabeçalho, junto do que ele governa. */
  filtro?: React.ReactNode
  children: React.ReactNode
  rodape?: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-card p-3.5',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{titulo}</h3>
          {descricao ? (
            <p className="truncate text-[11px] text-muted-foreground">{descricao}</p>
          ) : null}
        </div>
        {contexto ? <div className="shrink-0 text-sm tabular-nums">{contexto}</div> : null}
      </header>

      {filtro ? <div>{filtro}</div> : null}

      <div className="min-h-0 flex-1">{children}</div>

      {rodape ? <footer className="pt-0.5 text-[11px] text-muted-foreground">{rodape}</footer> : null}
    </section>
  )
}

const brl = (n: number) =>
  n >= 1000
    ? `R$ ${Math.round(n / 1000).toLocaleString('pt-BR')} mil`
    : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const FAIXA: Record<string, string> = {
  alta: 'bg-red-500',
  media: 'bg-amber-500',
  baixa: 'bg-slate-300 dark:bg-slate-600',
}

/** Para onde o botão primário leva. */
export function destinoDoItem(bloco: string, item: ItemMeuDia): string | null {
  const cat = blocoCatalogado(bloco)
  const meta = item.meta as Record<string, string | undefined>
  switch (cat?.acao) {
    case 'abrir_empresa':
    case 'abrir_certificado':
      return item.empresa_id ? `/empresas/${item.empresa_id}` : null
    case 'abrir_card_nf':
      return '/comercial/nfs'
    case 'abrir_card_venda':
      return '/comercial/vendas'
    case 'abrir_card_lead':
      return '/comercial/sdr'
    case 'abrir_fornecedor':
      return '/comercial/fornecedores'
    case 'decidir_aceite':
      return '/comercial/comissoes'
    case 'abrir_conversa':
    case 'enviar_sugestao':
      return meta.conversa_id ? `/comunicacao/${meta.conversa_id}` : '/comunicacao'
    default:
      return null
  }
}

/**
 * A linha compacta — o formato padrão de um item dentro de um widget.
 *
 * Ela substituiu o card grande, e a diferença é de densidade: o card ocupava metade da
 * largura da tela para dizer três coisas. A linha diz as mesmas três e cabem oito num
 * cartão. O menu de ações usa o dropdown do Radix, que renderiza em PORTAL — a versão
 * anterior era um `absolute` dentro de um contêiner com `overflow-hidden`, e por isso o
 * seletor aparecia recortado embaixo do componente em vez de sobre ele.
 */
export function LinhaItem({
  item, bloco, onAdiar, onDescartar, onConcluir, compacta = false,
}: {
  item: ItemMeuDia
  bloco: string
  onAdiar: () => void
  onDescartar: () => void
  onConcluir: () => void
  compacta?: boolean
}) {
  const cat = blocoCatalogado(bloco)
  const href = destinoDoItem(bloco, item)
  const ehTarefa = cat?.acao === 'concluir_tarefa'

  return (
    <div className="flex items-start gap-2 py-1.5">
      <span
        className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', FAIXA[item.urgencia] ?? FAIXA.baixa)}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.titulo}</span>
          {item.valor !== null && item.valor > 0 ? (
            <span className="shrink-0 text-xs tabular-nums">{brl(item.valor)}</span>
          ) : null}
        </div>
        {!compacta ? (
          <p className="truncate text-[11px] text-muted-foreground">{item.motivo}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center">
        {ehTarefa ? (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={onConcluir}>
            {cat?.acaoRotulo}
          </Button>
        ) : href ? (
          <Button variant="ghost" size="sm" className="h-6 px-2" asChild>
            <Link href={href} target="_blank" rel="noopener noreferrer" aria-label={cat?.acaoRotulo}>
              <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
          </Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-1.5" aria-label="Mais ações">
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onAdiar}>Adiar até…</DropdownMenuItem>
            <DropdownMenuItem onSelect={onDescartar}>Não é relevante</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/** O widget padrão: as linhas do bloco, com rolagem quando passam da altura. */
export function ListaDeItens({
  bloco, onAdiar, onDescartar, onConcluir, altura = 'max-h-56',
}: {
  bloco: BlocoMeuDia
  onAdiar: (i: ItemMeuDia) => void
  onDescartar: (i: ItemMeuDia) => void
  onConcluir: (i: ItemMeuDia) => void
  altura?: string
}) {
  return (
    <div className={cn('divide-y divide-border overflow-y-auto pr-1', altura)}>
      {ordenarItens(bloco.itens).map((item) => (
        <LinhaItem
          key={item.referencia_id}
          item={item}
          bloco={bloco.tipo}
          onAdiar={() => onAdiar(item)}
          onDescartar={() => onDescartar(item)}
          onConcluir={() => onConcluir(item)}
        />
      ))}
    </div>
  )
}

/**
 * O filtro de um widget: opções lado a lado, com a CONTAGEM em cada uma.
 *
 * A contagem não é enfeite — é ela que dispensa clicar em cada opção para descobrir se
 * há algo lá. Um filtro que leva a uma lista vazia é um clique que o número já teria
 * evitado.
 */
export function SegmentoFiltro<T extends string>({
  valor, onMudar, opcoes, rotulo,
}: {
  valor: T
  onMudar: (v: T) => void
  opcoes: { valor: T; rotulo: string; total: number }[]
  rotulo: string
}) {
  return (
    <div role="group" aria-label={rotulo} className="flex rounded-md border border-border p-0.5">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => onMudar(o.valor)}
          className={cn(
            'flex-1 rounded-[3px] px-2 py-1 text-[11px] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            valor === o.valor
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {o.rotulo} <span className="tabular-nums opacity-70">{o.total}</span>
        </button>
      ))}
    </div>
  )
}
