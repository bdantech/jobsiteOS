import type { Metadata } from 'next'
import { Esteira } from '@/components/credito/esteira'

export const metadata: Metadata = { title: 'Esteira — Crédito' }

export default function CreditoPage() {
  return <Esteira />
}
