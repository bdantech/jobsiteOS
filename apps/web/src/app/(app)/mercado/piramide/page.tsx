import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAccessRoute, lerCamadaPromocao } from '@jobsiteos/core'
import { PiramidePagina } from '@/components/mercado/piramide/piramide-pagina'
import { isAdmin, requireSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Camadas do Mercado',
}

/**
 * Camadas (Settings do Mercado) — §5.1, `webOnly`.
 *
 * A rota continua /mercado/piramide: só o rótulo da tela mudou (o desenho não é mais
 * uma pirâmide), e mudar a URL quebraria links salvos sem ganho nenhum.
 *
 * Two locks, and they check different things:
 *   • canAccessRoute('/mercado') — the registry decides who sees the module at
 *     all, exactly as it does for the sidebar and the AI tool list;
 *   • isAdmin — authoring a camada rule reclassifies ~2M rows, so it is not a
 *     module-level permission. RLS says the same thing (camada_regras_admin),
 *     and this is what turns its 42501 into a redirect instead of a broken page.
 *
 * Neither is trusted by the server actions: every one of them re-checks.
 */
export default async function PiramidePage() {
  const context = await requireSessionContext()

  if (!canAccessRoute('/mercado', context.grantedModuleIds)) redirect('/sem-acesso')
  if (!isAdmin(context)) redirect('/sem-acesso')

  // Read on the server with the USER-scoped client: app_config is readable by any
  // active user (migration 0016), and lerCamadaPromocao falls back to the seeded
  // default on its own, so there is nothing to guard or re-derive here.
  const camadaPromocao = await lerCamadaPromocao(await createClient())

  return <PiramidePagina camadaPromocao={camadaPromocao} />
}
