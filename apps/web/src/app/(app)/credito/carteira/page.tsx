import type { Metadata } from 'next'
import { CarteiraCredito } from '@/components/credito/carteira'

export const metadata: Metadata = { title: 'Carteira — Crédito' }

export default function CreditoCarteiraPage() {
  return <CarteiraCredito />
}
