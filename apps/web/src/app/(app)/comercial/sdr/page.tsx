import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { FunilSdr } from '@/components/comercial/funil-sdr'

export const metadata: Metadata = { title: 'Funil de Reuniões' }

// A tela lê o funil do usuário logado; renderizar estático congelaria a contagem.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { ehGestor } = await contextoComercial()
  return <FunilSdr ehGestor={ehGestor} />
}
