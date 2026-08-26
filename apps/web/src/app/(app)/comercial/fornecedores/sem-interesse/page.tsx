import type { Metadata } from 'next'
import { FornecedoresSemInteresse } from '@/components/comercial/fornecedores/sem-interesse'

export const metadata: Metadata = { title: 'Sem Interesse em se Cadastrar — Comercial' }

// A lista é recortada por originador pela RLS, como o funil.
export const dynamic = 'force-dynamic'

export default function Pagina() {
  return <FornecedoresSemInteresse />
}
