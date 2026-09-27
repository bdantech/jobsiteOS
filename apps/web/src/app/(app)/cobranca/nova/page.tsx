import type { Metadata } from 'next'
import { NovaCobranca } from '@/components/cobranca/nova-cobranca'

export const metadata: Metadata = { title: 'Nova cobrança — Cobrança' }

/**
 * `?sacado=<cnpj da matriz>` abre a tela já no grupo — é o link que a ficha da empresa
 * e o relógio da apólice usam para "colocar em cobrança".
 */
export default async function NovaCobrancaPage({
  searchParams,
}: {
  searchParams: Promise<{ sacado?: string | string[] }>
}) {
  const { sacado } = await searchParams
  return <NovaCobranca sacadoInicial={Array.isArray(sacado) ? sacado[0] : (sacado ?? null)} />
}
