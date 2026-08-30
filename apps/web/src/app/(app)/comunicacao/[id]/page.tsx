import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireSessionContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { Inbox } from '@/components/comunicacao/inbox'

export const metadata: Metadata = { title: 'Conversa — Comunicação' }

/**
 * O deep link de uma conversa (`/comunicacao/<id>`).
 *
 * ── POR QUE ELE ABRE O INBOX, E NÃO UMA TELA SÓ DA CONVERSA ────────────────
 * Quem chega por notificação chegou para responder uma coisa e, quase sempre,
 * continua trabalhando a fila. Uma tela isolada obrigaria a voltar para achar a
 * próxima; o inbox com a conversa já aberta entrega as duas.
 *
 * A rota estática `/comunicacao/nao-vinculadas` vence esta no roteamento do Next
 * — segmento fixo tem precedência sobre dinâmico —, então não há colisão.
 */
async function meuVendedorId(usuarioId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from('vendedores')
    .select('id')
    .eq('usuario_id', usuarioId)
    .maybeSingle()
  return data?.id ?? null
}

export default async function ConversaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = await requireSessionContext()
  const vendedorId = await meuVendedorId(context.usuario.id)

  return (
    <Suspense fallback={null}>
      <Inbox meuVendedorId={vendedorId} conversaInicial={id} />
    </Suspense>
  )
}
