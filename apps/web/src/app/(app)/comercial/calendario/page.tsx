import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { Calendario } from '@/components/comercial/calendario'

export const metadata: Metadata = { title: 'Calendário' }

// A tela lê o funil do usuário logado; renderizar estático congelaria a contagem.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { ehGestor } = await contextoComercial()
  return <Calendario ehGestor={ehGestor} />
}
