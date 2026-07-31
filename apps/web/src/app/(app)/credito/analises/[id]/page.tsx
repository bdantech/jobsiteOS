import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { AnaliseDetalhe } from '@/components/credito/analise-detalhe'

export const metadata: Metadata = { title: 'Análise de crédito' }

const uuidSchema = z.string().uuid()

export default async function AnalisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // id não-uuid é 404, não consulta: o PostgREST responderia 22P02, que a tela mostraria
  // como caixa vermelha de erro em vez de "não encontrada".
  if (!uuidSchema.safeParse(id).success) notFound()
  return <AnaliseDetalhe id={id} />
}
