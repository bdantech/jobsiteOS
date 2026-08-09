import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { CarteiraVendedor } from '@/components/comercial/carteira-vendedor'

export const metadata: Metadata = { title: 'Carteira' }

// O volume do mês muda a cada antecipação convertida; estático serviria número velho.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { ehGestor } = await contextoComercial()
  return <CarteiraVendedor ehGestor={ehGestor} />
}
