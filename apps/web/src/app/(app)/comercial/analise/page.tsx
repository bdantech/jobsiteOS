import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { contextoComercial } from '@/lib/comercial'
import { AnaliseDoFunilTela } from '@/components/comercial/analise-tela'

export const metadata: Metadata = { title: 'Análise do funil — Comercial' }

export const dynamic = 'force-dynamic'

/**
 * A análise só conhece as etapas dos funis de REUNIÃO e de VENDA — quem trabalha NF
 * não tem o que ler aqui. Guarda na página pelo mesmo motivo das outras: o menu
 * esconder não impede digitar a rota, e uma tela vazia parece defeito.
 */
export default async function Pagina() {
  const { vendedor, ehGestor } = await contextoComercial()
  if (!ehGestor && vendedor?.tipo !== 'sdr' && vendedor?.tipo !== 'vendedor') {
    redirect('/comercial')
  }
  return <AnaliseDoFunilTela />
}
