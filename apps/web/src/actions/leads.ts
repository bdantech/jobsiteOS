'use server'

import { revalidatePath } from 'next/cache'
import { canAccessRoute, normalizarCampos, salvarFormularioSchema } from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

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

/**
 * Salva o formulário do construtor.
 *
 * `normalizarCampos` roda AQUI e não só na tela: ele é quem garante que o CNPJ seja o
 * primeiro campo e obrigatório, e a tela não é a única porta — esta action é chamável
 * por qualquer sessão autenticada. Sem CNPJ não há dedup de empresa, nem cadastral,
 * nem score, e o lead vira um e-mail solto numa caixa.
 */
export async function salvarFormularioAction(input: unknown): Promise<ActionResult<{ id: string; slug: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>

  const parsed = salvarFormularioSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados inválidos.', code: 'invalid' }
  }

  const dados = { ...parsed.data, campos: normalizarCampos(parsed.data.campos) }
  const { data, error } = await supabase.rpc('app_salvar_formulario', {
    p: dados as never,
  })
  if (error) {
    // O slug é único e vira URL pública. Colisão é o erro mais provável aqui, e o
    // texto do Postgres ("duplicate key value violates...") não ajuda ninguém.
    const msg = error.message.includes('formularios_slug_key')
      ? 'Já existe um formulário com este endereço. Escolha outro.'
      : error.message
    return { ok: false, message: msg, code: 'unknown' }
  }

  revalidatePath('/comercial/leads')
  return { ok: true, data: data as unknown as { id: string; slug: string } }
}
