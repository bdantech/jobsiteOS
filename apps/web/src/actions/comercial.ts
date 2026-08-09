'use server'

import { revalidatePath } from 'next/cache'
import {
  atribuirNf,
  definirCarteira,
  definirGestaoOperacao,
  gerarTokenIcs,
  moverLeadSdr,
  moverVenda,
  mudarStatusComissao,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { ActionResult } from './empresas'

/**
 * Mutations do módulo Comercial.
 *
 * O client é o do USUÁRIO, nunca o de service role: as RPCs são SECURITY DEFINER mas
 * checam `app_tem_modulo` e `app_gestor_comercial` por dentro, e é essa checagem que
 * decide quem pode mudar carteira e aprovar comissão. Passar o admin aqui anularia a
 * única autorização que existe.
 */

async function autorizar() {
  const context = await getSessionContext()
  if (!context) {
    return { erro: { ok: false as const, message: 'Sessão expirada.', code: 'auth' }, supabase: null }
  }
  if (!context.grantedModuleIds.includes('comercial')) {
    return { erro: { ok: false as const, message: 'Sem acesso ao módulo Comercial.', code: 'forbidden' }, supabase: null }
  }
  return { erro: null, supabase: await createClient() }
}

function falha(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
  return { ok: false, message, code: 'unknown' }
}

export async function definirGestaoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const e = (await definirGestaoOperacao(supabase, input)) as { id?: string } | null
    if (e?.id) revalidatePath(`/empresas/${e.id}`)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function definirCarteiraAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await definirCarteira(supabase, input)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function moverLeadAction(input: unknown): Promise<ActionResult<{ id: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const l = (await moverLeadSdr(supabase, input)) as { id?: string } | null
    return { ok: true, data: { id: l?.id ?? null } }
  } catch (error) {
    return falha(error)
  }
}

export async function moverVendaAction(input: unknown): Promise<ActionResult<{ id: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const v = (await moverVenda(supabase, input)) as { id?: string } | null
    return { ok: true, data: { id: v?.id ?? null } }
  } catch (error) {
    return falha(error)
  }
}

export async function atribuirNfAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await atribuirNf(supabase, input)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function mudarStatusComissaoAction(input: unknown): Promise<ActionResult<{ linhas: number }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const n = await mudarStatusComissao(supabase, input)
    return { ok: true, data: { linhas: n } }
  } catch (error) {
    return falha(error)
  }
}

/** Gera (e revoga o anterior) o link .ics do calendário. */
export async function gerarTokenIcsAction(vendedorId?: string): Promise<ActionResult<{ token: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const token = await gerarTokenIcs(supabase, vendedorId)
    return { ok: true, data: { token } }
  } catch (error) {
    return falha(error)
  }
}
