import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { Comissoes } from '@/components/comercial/comissoes'

export const metadata: Metadata = { title: 'Comissões' }

// A tela lê o funil do usuário logado; renderizar estático congelaria a contagem.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { ehGestor } = await contextoComercial()
  return <Comissoes ehGestor={ehGestor} />
}
