import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { ContasWhatsapp } from '@/components/comunicacao/contas-whatsapp'

export const metadata: Metadata = { title: 'Contas WhatsApp — Comunicação' }

/**
 * Admin-only, e não porque o conteúdo seja sensível: marcar um número como `ia`
 * ou desligar o warmup dele muda como TODO o time aparece para fora. A RLS de
 * escrita (`app_is_admin()` no RPC) é quem manda; este gate só evita oferecer a
 * tela a quem receberia um erro ao salvar.
 */
export default async function ContasWhatsappPage() {
  const context = await requireSessionContext()
  if (!canAccessRoute('/comunicacao', context.grantedModuleIds) || !isAdmin(context)) {
    redirect('/sem-acesso')
  }
  return <ContasWhatsapp />
}
