import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AoVivo } from '@/components/agentes/ao-vivo'

export const metadata: Metadata = { title: 'Ao vivo — Agentes' }

/**
 * Ao vivo (Prompt 09 §11.1), a aba padrão. O acesso ao módulo já foi checado no layout;
 * quem vê quais agentes é a RLS (gestor vê todos, closer vê os seus).
 */
export default function AgentesAoVivoPage() {
  return (
    // `useSearchParams` (o `?m=<id>` do modal do mandato) exige Suspense no App Router.
    <Suspense fallback={null}>
      <AoVivo />
    </Suspense>
  )
}
