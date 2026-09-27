import type { Metadata } from 'next'
import { PersonasTela } from '@/components/agentes/personas-lista'

export const metadata: Metadata = { title: 'Personas — Agentes' }

export default function AgentesPersonasPage() {
  return <PersonasTela />
}
