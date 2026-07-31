import type { Metadata } from 'next'
import { ScorecardEditor } from '@/components/credito/scorecard-editor'

export const metadata: Metadata = { title: 'Scorecard — Crédito' }

/**
 * webOnly de propósito (04d §7): é uma tela de calibragem com tabela de pesos e prévia
 * de distribuição. Espremer isso numa tela de 6" produziria uma versão pior das duas.
 */
export default function ScorecardPage() {
  return <ScorecardEditor />
}
