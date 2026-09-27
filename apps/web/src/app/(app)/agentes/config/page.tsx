import type { Metadata } from 'next'
import { ConfigAgentesTela } from '@/components/agentes/config-agentes'

export const metadata: Metadata = { title: 'Configurações — Agentes' }

export default function AgentesConfigPage() {
  return <ConfigAgentesTela />
}
