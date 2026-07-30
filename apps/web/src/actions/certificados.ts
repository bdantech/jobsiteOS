'use server'

import { revalidatePath } from 'next/cache'
import { canAccessRoute } from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dispararSincronizarCertificados } from '@/lib/mercado/worker'

/**
 * Escritas do grid de certificados (04b §4).
 *
 * Ocultar/reexibir passa por RPC, e não por insert direto, por duas razões que a
 * policy sozinha não cobre: carimbar `oculto_por = auth.uid()` sem confiar no
 * cliente, e recusar a MATRIZ de um cliente — que é uma regra de negócio, não de
 * permissão.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string; code: string }

const SEM_ACESSO = {
  ok: false as const,
  message: 'Você não tem acesso ao módulo Empresas.',
  code: 'forbidden',
}

async function autorizar() {
  const context = await getSessionContext()
  if (!context) {
    return { erro: { ok: false as const, message: 'Sua sessão expirou.', code: 'forbidden' }, supabase: null }
  }
  if (!canAccessRoute('/empresas', context.grantedModuleIds)) {
    return { erro: SEM_ACESSO, supabase: null }
  }
  return { erro: null, supabase: await createClient() }
}

export async function ocultarSpeAction(cnpj: string): Promise<ActionResult<null>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro

  const { error } = await supabase.rpc('app_ocultar_spe_certificado' as never, { p_cnpj: cnpj } as never)
  if (error) return { ok: false, message: error.message, code: 'unknown' }
  revalidatePath('/empresas/certificados')
  return { ok: true, data: null }
}

export async function reexibirSpeAction(cnpj: string): Promise<ActionResult<null>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro

  const { error } = await supabase.rpc('app_reexibir_spe_certificado' as never, { p_cnpj: cnpj } as never)
  if (error) return { ok: false, message: error.message, code: 'unknown' }
  revalidatePath('/empresas/certificados')
  return { ok: true, data: null }
}

/**
 * Sync manual. O sync roda diariamente encadeado ao dos clientes Onepay; este botão
 * existe para quem acabou de renovar um certificado e não quer esperar até amanhã
 * para ver o quadrado mudar de cor.
 */
export async function sincronizarCertificadosAction(): Promise<
  ActionResult<{ enfileirado: boolean; aviso?: string }>
> {
  const { erro } = await autorizar()
  if (erro) return erro

  const r = await dispararSincronizarCertificados()
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}
