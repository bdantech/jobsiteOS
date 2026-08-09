import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { MeuPainel } from '@/components/comercial/meu-painel'

export const metadata: Metadata = { title: 'Painel do Comercial' }

// A tela lê o funil do usuário logado; renderizar estático congelaria a contagem.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { ehGestor } = await contextoComercial()
  return <MeuPainel ehGestor={ehGestor} />
}
