import type { Metadata } from 'next'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { CarteiraVendedor } from '@/components/comercial/carteira-vendedor'

export const metadata: Metadata = { title: 'Carteira' }

// O volume do mês muda a cada antecipação convertida; estático serviria número velho.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const context = await requireSessionContext()
  const supabase = await createClient()
  const { data: vendedor } = await supabase
    .from('vendedores')
    .select('id')
    .eq('usuario_id', context.usuario.id)
    .eq('ativo', true)
    .maybeSingle()
  const ehGestor = isAdmin(context) || !vendedor

  return <CarteiraVendedor ehGestor={ehGestor} />
}
