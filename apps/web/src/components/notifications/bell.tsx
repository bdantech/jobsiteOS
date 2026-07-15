'use client'

import * as React from 'react'
import Link from 'next/link'
import { Bell, CheckCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useNotificacoes } from './use-notificacoes'
import {
  NotificacoesErro,
  NotificacoesLista,
  NotificacoesSkeleton,
  NotificacoesVazio,
} from './notificacoes-lista'

/**
 * Mounted bare by the shell (`<NotificationsBell />`), so it takes no required
 * props and resolves its own user. Everything below the hook is presentation.
 */
export function NotificationsBell({ className }: { className?: string }) {
  const [aberto, setAberto] = React.useState(false)
  const { notificacoes, naoLidas, isLoading, isError, recarregar, marcarUma, marcarTodas, marcandoTodas } =
    useNotificacoes()

  const rotulo =
    naoLidas > 0
      ? `Notificações (${naoLidas} não ${naoLidas === 1 ? 'lida' : 'lidas'})`
      : 'Notificações'

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={rotulo}
          className={cn('relative', className)}
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {naoLidas > 0 && (
            <span
              aria-hidden="true"
              className={cn(
                'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center',
                'rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-brand-foreground',
                'ring-2 ring-background',
              )}
            >
              {naoLidas > 9 ? '9+' : naoLidas}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-[380px] max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold">Notificações</h2>
          {naoLidas > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => marcarTodas()}
              disabled={marcandoTodas}
            >
              <CheckCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Marcar todas
            </Button>
          )}
        </div>

        <Separator />

        <div className="max-h-[min(60vh,420px)] overflow-y-auto">
          {isLoading ? (
            <NotificacoesSkeleton itens={4} />
          ) : isError ? (
            <NotificacoesErro compacto onTentarNovamente={recarregar} />
          ) : notificacoes.length === 0 ? (
            <NotificacoesVazio compacto />
          ) : (
            <NotificacoesLista
              notificacoes={notificacoes}
              onMarcarUma={marcarUma}
              onNavegar={() => setAberto(false)}
            />
          )}
        </div>

        <Separator />

        <div className="p-2">
          <Button asChild variant="ghost" size="sm" className="w-full justify-center text-xs">
            <Link href="/notificacoes" onClick={() => setAberto(false)}>
              Ver todas as notificações
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
