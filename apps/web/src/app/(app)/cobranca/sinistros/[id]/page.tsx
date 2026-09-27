import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SinistroDetalhe } from '@/components/cobranca/sinistro-detalhe'

export const metadata: Metadata = { title: 'Sinistro — Cobrança' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function SinistroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Id malformado é link quebrado, não "sinistro não encontrado".
  if (!UUID.test(id)) notFound()
  return <SinistroDetalhe id={id} />
}
