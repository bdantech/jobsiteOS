'use client'

import { CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useNotificacoes } from './use-notificacoes'
import {
  NotificacoesErro,
  NotificacoesLista,
  NotificacoesSkeleton,
  NotificacoesVazio,
} from './notificacoes-lista'
import { PushToggle } from './push-toggle'

/**
 * Same hook, same query cache as the bell — marking something read here updates
 * the badge instantly, and vice versa, without any shared store.
 */
export function NotificacoesPagina() {
  const { notificacoes, naoLidas, isLoading, isError, recarregar, marcarUma, marcarTodas, marcandoTodas } =
    useNotificacoes()

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notificações</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? 'Carregando…'
              : naoLidas > 0
                ? `${naoLidas} não ${naoLidas === 1 ? 'lida' : 'lidas'}`
                : 'Tudo em dia.'}
          </p>
        </div>

        {naoLidas > 0 && (
          <Button variant="outline" size="sm" onClick={() => marcarTodas()} disabled={marcandoTodas}>
            <CheckCheck className="mr-2 h-4 w-4" aria-hidden="true" />
            Marcar todas como lidas
          </Button>
        )}
      </header>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <NotificacoesSkeleton itens={6} />
          ) : isError ? (
            <NotificacoesErro onTentarNovamente={recarregar} />
          ) : notificacoes.length === 0 ? (
            <NotificacoesVazio />
          ) : (
            <NotificacoesLista notificacoes={notificacoes} onMarcarUma={marcarUma} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preferências deste dispositivo</CardTitle>
          <CardDescription>
            O push é registrado por navegador. Ative em cada dispositivo em que quiser receber avisos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PushToggle />
        </CardContent>
      </Card>
    </div>
  )
}
