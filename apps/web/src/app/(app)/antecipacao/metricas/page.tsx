import type { Metadata } from 'next'
import { MetricasFaixa } from '@/components/antecipacao/metricas-faixa'

export const metadata: Metadata = { title: 'Métricas — Antecipação' }

export default function MetricasPage() {
  return <MetricasFaixa />
}
