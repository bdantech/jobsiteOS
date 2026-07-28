import type { Metadata } from 'next'
import { normalizeCnpj } from '@jobsiteos/core'
import { SacadoDetalhe } from '@/components/antecipacao/sacado-detalhe'

export const metadata: Metadata = { title: 'Sacado — Antecipação' }

/**
 * Uma rota, dois caminhos de entrada: a aba "Por sacado" (capacidade) e
 * "Sacados a prospectar". A tela mostra as duas leituras agregadas e volta para
 * a lista de onde a pessoa veio.
 */
export default async function SacadoPage({ params }: { params: Promise<{ cnpj: string }> }) {
  const { cnpj } = await params
  return <SacadoDetalhe cnpj={normalizeCnpj(decodeURIComponent(cnpj))} />
}
