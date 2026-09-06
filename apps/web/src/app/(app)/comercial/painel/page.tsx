import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { contextoComercial } from '@/lib/comercial'
import { MeuPainel } from '@/components/comercial/meu-painel'

export const metadata: Metadata = { title: 'Painel do Comercial' }

// A tela lê o funil do usuário logado; renderizar estático congelaria a contagem.
export const dynamic = 'force-dynamic'

/**
 * Guarda na PÁGINA, e não só na navegação — o mesmo padrão de /fila e /admin. O painel
 * é a tela de olhar o trabalho dos outros, e é do gestor.
 */
export default async function Pagina() {
  const { ehGestor } = await contextoComercial()
  if (!ehGestor) redirect('/comercial')

  return <MeuPainel ehGestor={ehGestor} />
}
