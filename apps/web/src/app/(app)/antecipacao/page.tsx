import type { Metadata } from 'next'
import { FunilKanban } from '@/components/antecipacao/funil-kanban'

export const metadata: Metadata = { title: 'Funil — Antecipação' }

/**
 * O funil é a tela inicial do módulo, e não um dashboard: quem abre Antecipação
 * quer trabalhar notas, não olhar números. Os números por faixa moram em Métricas.
 */
export default function AntecipacaoPage() {
  return <FunilKanban />
}
