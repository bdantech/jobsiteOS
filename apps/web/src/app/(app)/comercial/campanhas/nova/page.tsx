import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { contextoComercial } from '@/lib/comercial'
import { ConstrutorDeCampanha } from '@/components/campanhas/construtor'

export const metadata: Metadata = { title: 'Nova campanha — Comercial' }
export const dynamic = 'force-dynamic'

/**
 * Criar campanha é gestor. O RPC recusa de qualquer forma, mas oferecer a tela e
 * depois recusar a gravação ensina a pessoa que o sistema erra.
 */
export default async function Pagina() {
  const { ehGestor } = await contextoComercial()
  if (!ehGestor) redirect('/sem-acesso')
  // `useSearchParams` (o preset vem pela URL) exige fronteira de Suspense no build.
  return (
    <Suspense fallback={null}>
      <ConstrutorDeCampanha />
    </Suspense>
  )
}
