import type { Metadata } from 'next'
import { SinistrosLista } from '@/components/cobranca/sinistros-lista'

export const metadata: Metadata = { title: 'Sinistros — Cobrança' }

export default function SinistrosPage() {
  return <SinistrosLista />
}
