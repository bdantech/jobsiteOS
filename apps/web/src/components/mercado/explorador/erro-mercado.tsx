'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Backstop de rota para o que os estados de erro das próprias queries não
 * pegaram (uma server action que falhou na desserialização, um bug de render).
 * O caminho normal são os estados de erro dentro das telas.
 */
export function ErroMercado({
  error,
  reset,
  contexto,
}: {
  error: Error & { digest?: string }
  reset: () => void
  contexto: string
}) {
  React.useEffect(() => {
    console.error(`[mercado] erro não tratado em ${contexto}`, error)
  }, [error, contexto])

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <div className="rounded-full bg-destructive/10 p-3">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-medium">Algo deu errado</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Não foi possível exibir esta página. Tente novamente — se o erro persistir, avise o
            time.
          </p>
          {error.digest && (
            <p className="pt-2 font-mono text-xs text-muted-foreground">Código: {error.digest}</p>
          )}
        </div>
        <div className="flex gap-3">
          <Button variant="outline" asChild>
            <Link href="/mercado/explorador">Voltar para o Explorador</Link>
          </Button>
          <Button onClick={reset}>Tentar novamente</Button>
        </div>
      </CardContent>
    </Card>
  )
}
