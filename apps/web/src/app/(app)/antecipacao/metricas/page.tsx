import type { Metadata } from 'next'
import { MetricasFaixa } from '@/components/antecipacao/metricas-faixa'

export const metadata: Metadata = { title: 'Métricas por faixa — Antecipação' }

export default function MetricasPage() {
  return <MetricasFaixa />
}
