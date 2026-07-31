import type { Metadata } from 'next'
import { CreditoPainel } from '@/components/credito/painel'

export const metadata: Metadata = { title: 'Painel — Crédito' }

export default function CreditoPainelPage() {
  return <CreditoPainel />
}
