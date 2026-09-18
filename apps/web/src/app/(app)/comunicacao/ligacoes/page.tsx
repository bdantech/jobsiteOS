import type { Metadata } from 'next'
import { VozLigacoes } from '@/components/comunicacao/voz-ligacoes'

export const metadata: Metadata = { title: 'Ligações — Comunicação' }

export default function LigacoesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium">Ligações</h1>
        <p className="text-sm text-muted-foreground">
          A Ana liga para o fornecedor sobre uma nota, uma ligação por vez, em horário comercial.
          Aqui você põe uma nota na fila na hora que quiser — e vê, para cada nota que não entra,
          exatamente o que está faltando.
        </p>
      </div>
      <VozLigacoes />
    </div>
  )
}
