import type { Metadata } from 'next'
import { FornecedoresProspectar } from '@/components/antecipacao/fornecedores-prospectar'

export const metadata: Metadata = { title: 'Fornecedores a Prospectar — Antecipação' }

export default function ProspectarFornecedoresPage() {
  return <FornecedoresProspectar />
}
