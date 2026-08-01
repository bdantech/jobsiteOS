import type { Metadata } from 'next'
import { AntecipacoesLista } from '@/components/antecipacao/antecipacoes-lista'

export const metadata: Metadata = { title: 'Antecipações — Antecipação' }

/**
 * Para todo o time, não só admin: a fila de revisão é trabalho de quem opera o
 * funil, e um caso parado ali é receita real que o funil ainda não contou.
 *
 * `?id=` chega dos eventos de regressão e de "sem NF" — a tela abre com o caso
 * já expandido, para que a notificação leve à decisão e não a uma busca.
 */
export default async function AntecipacoesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const { id } = await searchParams
  const idInicial = id && /^\d+$/.test(id) ? Number(id) : undefined
  return <AntecipacoesLista idInicial={idInicial} />
}
