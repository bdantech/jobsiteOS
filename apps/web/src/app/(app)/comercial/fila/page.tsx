import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { FilaSemDono } from '@/components/comercial/fila-sem-dono'

export const metadata: Metadata = { title: 'Fila sem dono' }
export const dynamic = 'force-dynamic'

/**
 * Guarda na PÁGINA, não só na navegação: esconder o item de menu não impede ninguém de
 * digitar a rota, e a RPC por trás recusa — mas recusar com erro é pior que não deixar
 * entrar.
 */
export default async function Pagina() {
  const context = await requireSessionContext()
  const supabase = await createClient()
  const { data: vendedor } = await supabase
    .from('vendedores').select('id').eq('usuario_id', context.usuario.id).eq('ativo', true).maybeSingle()
  if (!isAdmin(context) && vendedor) redirect('/comercial')

  return <FilaSemDono />
}
