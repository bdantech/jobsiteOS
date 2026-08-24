import type { Metadata } from 'next'
import { AnaliseDoFunilTela } from '@/components/comercial/analise-tela'

export const metadata: Metadata = { title: 'Análise do funil — Comercial' }

export default function ComercialAnalisePage() {
  return <AnaliseDoFunilTela />
}
