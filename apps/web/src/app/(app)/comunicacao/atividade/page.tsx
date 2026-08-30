import type { Metadata } from 'next'
import { PainelDeAtividade } from '@/components/comunicacao/atividade'

export const metadata: Metadata = { title: 'Atividade — Comunicação' }

export default function AtividadePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium">Atividade de comunicação</h1>
        <p className="text-sm text-muted-foreground">
          Volume sempre lado a lado com resultado. Ninguém vê o próprio painel aqui — é uma decisão,
          não uma limitação.
        </p>
      </div>
      <PainelDeAtividade />
    </div>
  )
}
