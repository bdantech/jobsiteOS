import type { Metadata } from 'next'
import { OutboxLista } from '@/components/antecipacao/outbox-lista'

export const metadata: Metadata = { title: 'Outbox — Comunicação' }

/**
 * A fila da régua, e o lugar onde uma pessoa APROVA o que a máquina escreveu.
 * `pendente_envio → aprovada` acontece aqui, e é o worker de envio que consome
 * `aprovada` — sem esta tela a régua gera e nada sai, que é exatamente a intenção.
 *
 * Sem gate de admin: é o time inteiro que responde "essa mensagem pode ir para o
 * meu fornecedor?". O layout do módulo já barrou quem não tem Comunicação.
 */
export default function OutboxPage() {
  return <OutboxLista />
}
