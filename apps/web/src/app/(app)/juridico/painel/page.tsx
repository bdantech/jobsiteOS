import type { Metadata } from 'next'
import { PainelJuridico } from '@/components/juridico/painel'

export const metadata: Metadata = { title: 'Painel — Jurídico' }

export default function PainelPage() {
  return <PainelJuridico />
}
