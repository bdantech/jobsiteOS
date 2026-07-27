import type { Metadata } from 'next'
import { OutboxLista } from '@/components/antecipacao/outbox-lista'

export const metadata: Metadata = { title: 'Outbox — Antecipação' }

/**
 * A fila-sombra é para todo o time ver, não só para admin: é ela que responde
 * "que mensagem chegaria ao meu fornecedor?" antes de qualquer canal existir.
 */
export default function OutboxPage() {
  return <OutboxLista />
}
