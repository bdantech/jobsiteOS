import type { Metadata } from 'next'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { MeuPainel } from '@/components/comercial/meu-painel'

export const metadata: Metadata = { title: 'Painel do Comercial' }

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

  return <MeuPainel ehGestor={ehGestor} />
}
