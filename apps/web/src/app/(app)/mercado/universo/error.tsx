'use client'

import { ErroMercado } from '@/components/mercado/explorador/erro-mercado'

export default function ErroUniverso({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErroMercado error={error} reset={reset} contexto="universo" />
}
