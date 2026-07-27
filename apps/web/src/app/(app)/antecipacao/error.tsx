'use client'

import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function AntecipacaoError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-20 text-center">
        <div className="rounded-full bg-destructive/10 p-3">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-medium">Não foi possível carregar a Antecipação</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Pode ser uma queda momentânea de conexão com o banco. Tentar de novo costuma resolver.
          </p>
        </div>
        <Button variant="outline" onClick={reset}>
          Tentar novamente
        </Button>
      </CardContent>
    </Card>
  )
}
