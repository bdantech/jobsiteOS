'use client'

import * as React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Boundary for failures the page's own error state can't catch — i.e. the RSC
 * render itself throwing (session lookup, permissions query). The in-list error
 * state in NotificacoesPagina handles fetch failures below this.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    // The digest is the only handle on the server-side stack, which Next
    // deliberately withholds from the browser in production.
    console.error('Falha ao carregar /notificacoes:', error)
  }, [error])

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
          </div>
          <h1 className="text-base font-semibold">Não foi possível carregar as notificações</h1>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Algo deu errado ao abrir esta página. Tente novamente em instantes.
          </p>
          {error.digest !== undefined && (
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              Código: {error.digest}
            </p>
          )}
          <Button variant="outline" size="sm" className="mt-4" onClick={reset}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
