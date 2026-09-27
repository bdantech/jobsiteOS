import type { Metadata } from 'next'
import { MateriaisTela } from '@/components/agentes/materiais-biblioteca'

export const metadata: Metadata = { title: 'Materiais — Agentes' }

export default function AgentesMateriaisPage() {
  return <MateriaisTela />
}
