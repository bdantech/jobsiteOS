'use client'

import { useEffect } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Never render `error.message`: on the server it can carry an internal
    // string. The digest is what correlates this screen with the server log.
    console.error('settings', error.digest)
  }, [error])

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 py-10 text-center">
      <AlertCircle className="h-8 w-8 text-destructive" aria-hidden />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Não foi possível carregar as configurações</h2>
        <p className="text-sm text-muted-foreground">
          Tente novamente. Se o problema continuar, fale com um administrador.
        </p>
      </div>
      <Button onClick={reset}>Tentar novamente</Button>
    </div>
  )
}
