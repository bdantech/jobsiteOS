import type { Metadata } from 'next'
import { Suspense } from 'react'
import { MandatosKanban } from '@/components/agentes/mandatos-kanban'

export const metadata: Metadata = { title: 'Mandatos — Agentes' }

/**
 * Mandatos (Prompt 09 §11.2): propostas aguardando aprovação e o kanban por estado.
 * `?m=<id>` abre o modal do mandato — é o link das notificações e dos eventos da empresa —
 * e `?proposta=<id>` destaca uma proposta.
 */
export default function AgentesMandatosPage() {
  return (
    // `useSearchParams` exige Suspense no App Router.
    <Suspense fallback={null}>
      <MandatosKanban />
    </Suspense>
  )
}
