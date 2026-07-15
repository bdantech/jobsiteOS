'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Route-level backstop for the whole Mercado module — anything the per-query error
 * states inside the pages did not catch (a render-time bug, a failed server action
 * deserialization). The in-page states are the normal path.
 */
export default function ErroMercado({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[mercado] erro não tratado', error)
  }, [error])

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <div className="rounded-full bg-destructive/10 p-3">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-medium">Algo deu errado</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Não foi possível exibir esta página do Mercado. Tente novamente — se o erro persistir,
            avise o time.
          </p>
          {error.digest && (
            <p className="pt-2 font-mono text-xs text-muted-foreground">Código: {error.digest}</p>
          )}
        </div>
        <div className="flex gap-3">
          <Button variant="outline" asChild>
            <Link href="/mercado">Voltar para o Mapa</Link>
          </Button>
          <Button onClick={reset}>Tentar novamente</Button>
        </div>
      </CardContent>
    </Card>
  )
}
