import type { Metadata } from 'next'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Calendario } from '@/components/comercial/calendario'

export const metadata: Metadata = { title: 'Calendário' }

// A tela lê o funil do usuário logado; renderizar estático congelaria a contagem.
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

  return <Calendario ehGestor={ehGestor} />
}
