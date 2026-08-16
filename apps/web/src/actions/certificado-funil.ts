'use server'

import { revalidatePath } from 'next/cache'
import { canAccessRoute, moverCertificadoCardSchema } from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * Escritas do funil de certificados (0116).
 *
 * O gate aqui é `/comercial`, e não `/empresas` como no grid: são duas telas sobre o
 * mesmo dado com donos diferentes — o grid é consulta de cobertura para quem cuida
 * das empresas, o funil é trabalho de originação.
 *
 * As regras (ganho exige matriz coberta, perda exige motivo, `pendente_spes` é da
 * máquina) moram no RPC. Aqui só se traduz o erro do Postgres para uma frase — a
 * validação no cliente serve para desabilitar botão, nunca para autorizar.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string; code: string }

async function autorizar() {
  const context = await getSessionContext()
  if (!context) {
    return { erro: { ok: false as const, message: 'Sua sessão expirou.', code: 'forbidden' }, supabase: null }
  }
  if (!canAccessRoute('/comercial', context.grantedModuleIds)) {
    return {
      erro: { ok: false as const, message: 'Você não tem acesso ao módulo Comercial.', code: 'forbidden' },
      supabase: null,
    }
  }
  return { erro: null, supabase: await createClient() }
}

export async function moverCertificadoCardAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>

  const parsed = moverCertificadoCardSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados inválidos.', code: 'invalid' }
  }

  const { data, error } = await supabase.rpc(
    'app_mover_certificado_card' as never,
    { p: parsed.data } as never,
  )
  if (error) return { ok: false, message: error.message, code: 'unknown' }

  revalidatePath('/comercial/certificados')
  return { ok: true, data: { id: (data as { id: string } | null)?.id ?? parsed.data.card_id } }
}

/**
 * Reconcilia o funil com a tabela de certificados AGORA.
 *
 * O worker chama isto todo dia depois do sync; o botão existe para quem acabou de
 * receber o certificado do cliente e não quer esperar até amanhã para o card sair da
 * coluna. É idempotente — clicar duas vezes não faz nada duas vezes.
 */
export async function sincronizarFunilCertificadosAction(): Promise<
  ActionResult<{ abertos: number; ganhos: number; reabertos: number }>
> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>

  const { data, error } = await supabase.rpc('certificado_funil_sincronizar' as never)
  if (error) return { ok: false, message: error.message, code: 'unknown' }

  const r = (data ?? {}) as { abertos?: number; ganhos?: number; reabertos?: number }
  revalidatePath('/comercial/certificados')
  return {
    ok: true,
    data: { abertos: r.abertos ?? 0, ganhos: r.ganhos ?? 0, reabertos: r.reabertos ?? 0 },
  }
}
