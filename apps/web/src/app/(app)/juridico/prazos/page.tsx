import type { Metadata } from 'next'
import { PrazosAgenda } from '@/components/juridico/prazos-agenda'

export const metadata: Metadata = { title: 'Prazos — Jurídico' }

export default function PrazosPage() {
  return <PrazosAgenda />
}
