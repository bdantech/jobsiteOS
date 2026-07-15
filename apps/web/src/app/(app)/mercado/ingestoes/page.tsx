import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { IngestoesLista } from '@/components/mercado/ingestoes/ingestoes-lista'

export const metadata: Metadata = {
  title: 'Ingestões — Mercado',
}

/**
 * Ingestões (spec §5.6, webOnly).
 *
 * TWO different gates, on purpose:
 *
 *  - VIEWING is gated by the `mercado` module, like every other page in this
 *    module. RLS already agrees (mercado_ingestoes is SELECT-only, gated by
 *    app_tem_modulo('mercado')), so anyone who can see the pyramid can also see
 *    whether last month's Receita load actually landed — that context belongs to
 *    whoever is reading the numbers.
 *
 *  - TRIGGERING is admin-only. `podeExecutar` merely hides the buttons; the real
 *    check is inside dispararIngestaoAction, which re-verifies admin server-side
 *    before the WORKER_SECRET is ever touched.
 */
export default async function IngestoesPage() {
  const context = await requireSessionContext()
  if (!canAccessRoute('/mercado', context.grantedModuleIds)) redirect('/sem-acesso')

  return <IngestoesLista podeExecutar={isAdmin(context)} />
}
