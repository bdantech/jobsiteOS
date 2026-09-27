import type { Metadata } from 'next'
import { KanbanCobrancas } from '@/components/cobranca/kanban-cobrancas'

export const metadata: Metadata = { title: 'Cobranças — Cobrança' }

export default function CobrancasPage() {
  return <KanbanCobrancas />
}
