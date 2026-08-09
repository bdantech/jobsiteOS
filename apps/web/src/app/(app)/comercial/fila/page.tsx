import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { contextoComercial } from '@/lib/comercial'
import { FilaSemDono } from '@/components/comercial/fila-sem-dono'

export const metadata: Metadata = { title: 'Fila sem Dono' }
export const dynamic = 'force-dynamic'

/**
 * Guarda na PÁGINA, não só na navegação: esconder o item de menu não impede ninguém de
 * digitar a rota, e a RPC por trás recusa — mas recusar com erro é pior que não deixar
 * entrar.
 */
export default async function Pagina() {
  const { ehGestor } = await contextoComercial()
  if (!ehGestor) redirect('/comercial')

  return <FilaSemDono />
}
