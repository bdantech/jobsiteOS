import type { Metadata } from 'next'
import { ModelosCobranca } from '@/components/cobranca/modelos'

export const metadata: Metadata = { title: 'Modelos — Cobrança' }

export default function ModelosPage() {
  return <ModelosCobranca />
}
