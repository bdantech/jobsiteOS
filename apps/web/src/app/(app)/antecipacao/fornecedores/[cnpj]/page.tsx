import type { Metadata } from 'next'
import { normalizeCnpj } from '@jobsiteos/core'
import { FornecedorDetalhe } from '@/components/antecipacao/fornecedor-detalhe'

export const metadata: Metadata = { title: 'Fornecedor — Antecipação' }

export default async function FornecedorPage({ params }: { params: Promise<{ cnpj: string }> }) {
  const { cnpj } = await params
  // O CNPJ da URL pode vir com pontuação; a coluna guarda 14 dígitos.
  return <FornecedorDetalhe cnpj={normalizeCnpj(decodeURIComponent(cnpj))} />
}
