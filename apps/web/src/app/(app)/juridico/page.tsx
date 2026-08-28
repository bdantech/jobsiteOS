import type { Metadata } from 'next'
import { Carteira } from '@/components/juridico/carteira'

export const metadata: Metadata = { title: 'Processos — Jurídico' }

export default function JuridicoPage() {
  return <Carteira />
}
