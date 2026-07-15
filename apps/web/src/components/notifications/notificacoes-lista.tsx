'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { BellOff, Inbox, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { Notificacao } from './use-notificacoes'

function tempoRelativo(iso: string): string {
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return ''
  return formatDistanceToNow(data, { addSuffix: true, locale: ptBR })
}

// ─── States ─────────────────────────────────────────────────────────────────

export function NotificacoesSkeleton({ itens = 4 }: { itens?: number }) {
  return (
    <ul className="divide-y divide-border" aria-busy="true" aria-live="polite">
      {Array.from({ length: itens }).map((_, i) => (
        <li key={i} className="flex gap-3 px-4 py-3">
          <Skeleton className="mt-1.5 h-2 w-2 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-20" />
          </div>
        </li>
      ))}
      <li className="sr-only">Carregando notificações…</li>
    </ul>
  )
}

export function NotificacoesVazio({ compacto = false }: { compacto?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compacto ? 'py-10' : 'py-16',
      )}
    >
      <div className="mb-3 rounded-full bg-muted p-3">
        <Inbox className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium">Nenhuma notificação</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        Quando algo acontecer nas suas empresas, você será avisado por aqui.
      </p>
    </div>
  )
}

export function NotificacoesErro({
  onTentarNovamente,
  compacto = false,
}: {
  onTentarNovamente: () => void
  compacto?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compacto ? 'py-10' : 'py-16',
      )}
      role="alert"
    >
      <div className="mb-3 rounded-full bg-destructive/10 p-3">
        <BellOff className="h-5 w-5 text-destructive" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium">Não foi possível carregar</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        Verifique sua conexão e tente novamente.
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onTentarNovamente}>
        <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
        Tentar novamente
      </Button>
    </div>
  )
}

// ─── List ───────────────────────────────────────────────────────────────────

interface NotificacoesListaProps {
  notificacoes: Notificacao[]
  onMarcarUma: (id: string) => void
  /** Bell closes its popover on navigate; the page has nothing to close. */
  onNavegar?: () => void
}

export function NotificacoesLista({
  notificacoes,
  onMarcarUma,
  onNavegar,
}: NotificacoesListaProps) {
  const router = useRouter()

  const abrir = React.useCallback(
    (notificacao: Notificacao) => {
      if (!notificacao.lida) onMarcarUma(notificacao.id)
      if (notificacao.url !== null && notificacao.url.length > 0) {
        onNavegar?.()
        router.push(notificacao.url)
      }
    },
    [onMarcarUma, onNavegar, router],
  )

  return (
    <ul className="divide-y divide-border">
      {notificacoes.map((notificacao) => {
        const navegavel = notificacao.url !== null && notificacao.url.length > 0

        return (
          <li key={notificacao.id}>
            {/*
              A <button> rather than an <a>: the row both mutates (mark as read)
              and may navigate, and half of them have no url at all. Rendering a
              link with no href would be a lie to assistive tech and to
              middle-click.
            */}
            <button
              type="button"
              onClick={() => abrir(notificacao)}
              aria-label={`${notificacao.titulo}${notificacao.lida ? '' : ' (não lida)'}`}
              className={cn(
                'flex w-full gap-3 px-4 py-3 text-left transition-colors',
                'hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                !navegavel && !notificacao.lida && 'cursor-default',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                  notificacao.lida ? 'bg-transparent' : 'bg-brand',
                )}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-sm',
                    notificacao.lida ? 'font-normal text-muted-foreground' : 'font-medium',
                  )}
                >
                  {notificacao.titulo}
                </span>
                {notificacao.corpo !== null && notificacao.corpo.length > 0 && (
                  <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
                    {notificacao.corpo}
                  </span>
                )}
                <time
                  dateTime={notificacao.criado_em}
                  className="mt-1 block text-xs text-muted-foreground"
                >
                  {tempoRelativo(notificacao.criado_em)}
                </time>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
