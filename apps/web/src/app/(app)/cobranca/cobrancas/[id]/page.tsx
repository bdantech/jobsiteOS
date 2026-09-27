import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CobrancaDetalhe } from '@/components/cobranca/cobranca-detalhe'

export const metadata: Metadata = { title: 'Cobrança' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function CobrancaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Id malformado é link quebrado, não "cobrança não encontrada".
  if (!UUID.test(id)) notFound()
  return <CobrancaDetalhe cobrancaId={id} />
}
