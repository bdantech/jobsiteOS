import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireSessionContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { Inbox } from '@/components/comunicacao/inbox'

export const metadata: Metadata = { title: 'Inbox — Comunicação' }

/**
 * O vendedor da pessoa logada resolve a aba "Minhas".
 *
 * Lido com service role porque `vendedores` é do módulo Comercial, e quem tem
 * Comunicação sem Comercial não enxergaria a própria linha. A escalação é escopada
 * ao `usuario_id` da sessão e nada derivado de entrada do cliente entra na
 * consulta — é a mesma régua do `getSessionContext`.
 */
async function meuVendedorId(usuarioId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from('vendedores')
    .select('id')
    .eq('usuario_id', usuarioId)
    .maybeSingle()
  return data?.id ?? null
}

export default async function ComunicacaoPage() {
  const context = await requireSessionContext()
  const vendedorId = await meuVendedorId(context.usuario.id)

  return (
    // `useSearchParams` (o deep link `?conversa=`) exige Suspense no App Router.
    <Suspense fallback={null}>
      <Inbox meuVendedorId={vendedorId} />
    </Suspense>
  )
}
