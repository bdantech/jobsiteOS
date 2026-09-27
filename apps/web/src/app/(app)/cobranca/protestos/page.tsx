import type { Metadata } from 'next'
import { ProtestosLista } from '@/components/cobranca/protestos-lista'

export const metadata: Metadata = { title: 'Protestos — Cobrança' }

export default function ProtestosPage() {
  return <ProtestosLista />
}
