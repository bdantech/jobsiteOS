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

/*
 * NÃO HÁ ACTION DE SINCRONIZAR AQUI, e a ausência é deliberada.
 *
 * A reconciliação (`certificado_funil_sincronizar`) roda dentro do job diário de
 * certificados, logo depois de a tabela ser reescrita — é lá que ela pertence, porque
 * reconciliar antes do dado chegar não faz nada e depois de a tela abrir chega tarde.
 *
 * O botão manual saiu do funil: com a alimentação automática ele só oferecia a chance
 * de clicar em algo que não muda nada. Quem precisar forçar tem o "Sincronizar" do
 * grid em /empresas/certificados, que dispara o job inteiro — e o job reconcilia o
 * funil no fim.
 */
