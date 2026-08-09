import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { FunilVendas } from '@/components/comercial/funil-vendas'

export const metadata: Metadata = { title: 'Funil de Vendas' }

// A tela lê o funil do usuário logado; renderizar estático congelaria a contagem.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { ehGestor } = await contextoComercial()
  return <FunilVendas ehGestor={ehGestor} />
}
