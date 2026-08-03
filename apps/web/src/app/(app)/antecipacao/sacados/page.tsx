import type { Metadata } from 'next'
import { SacadosLista } from '@/components/antecipacao/sacados-lista'

export const metadata: Metadata = { title: 'Por Sacado — Antecipação' }

export default function SacadosPage() {
  return <SacadosLista />
}
