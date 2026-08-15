import type { Metadata } from 'next'
import { FornecedoresSemInteresse } from '@/components/antecipacao/fornecedores-sem-interesse'

export const metadata: Metadata = { title: 'Sem Interesse em se Cadastrar — Antecipação' }

export default function FornecedoresSemInteressePage() {
  return <FornecedoresSemInteresse />
}
