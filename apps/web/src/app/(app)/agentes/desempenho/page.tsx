import type { Metadata } from 'next'
import { DesempenhoTela } from '@/components/agentes/desempenho-painel'

export const metadata: Metadata = { title: 'Painel — Agentes' }

export default function AgentesDesempenhoPage() {
  return <DesempenhoTela />
}
