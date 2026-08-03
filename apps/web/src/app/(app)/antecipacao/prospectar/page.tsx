import type { Metadata } from 'next'
import { SacadosProspectar } from '@/components/antecipacao/sacados-prospectar'

export const metadata: Metadata = { title: 'Sacados a Prospectar — Antecipação' }

export default function ProspectarPage() {
  return <SacadosProspectar />
}
