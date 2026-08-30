'use server'

import { revalidatePath } from 'next/cache'
import {
  aprovarCampanha,
  cancelarCampanha,
  pausarCampanha,
  retomarCampanha,
  salvarCampanha,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dispararExecutarCampanhas, dispararSimularCampanha } from '@/lib/mercado/worker'
import type { ActionResult } from './empresas'

/**
 * Mutações de campanha (05B).
 *
 * Como em toda a casa, o client é o do USUÁRIO. As RPCs são SECURITY DEFINER mas
 * checam `app_gestor_comercial()` por dentro — passar o service role aqui
 * anularia a única autorização que existe, e o que está em jogo não é um card: é
 * um disparo para mil pessoas.
 */

async function autorizar() {
  const context = await getSessionContext()
  if (!context) {
    return { erro: { ok: false as const, message: 'Sessão expirada.', code: 'auth' }, supabase: null }
  }
  return { erro: null, supabase: await createClient() }
}

function falha(erro: unknown): ActionResult<never> {
  const message = erro instanceof Error ? erro.message : 'Não foi possível concluir a ação.'
  return { ok: false, message, code: 'erro' }
}

function revalidar(id?: string): void {
  revalidatePath('/comercial/campanhas')
  if (id) revalidatePath(`/comercial/campanhas/${id}`)
}

export async function salvarCampanhaAction(
  input: unknown,
): Promise<ActionResult<Tables<'campanhas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const c = await salvarCampanha(supabase, input)
    revalidar(c.id)
    return { ok: true, data: c }
  } catch (e) {
    return falha(e)
  }
}

/**
 * Salvar E simular, numa ação só.
 *
 * As duas juntas porque a simulação é sobre o que acabou de ser salvo — e porque
 * qualquer edição zera a simulação anterior no próprio RPC. Separá-las deixaria
 * a tela num estado em que o botão "aprovar" aparece desabilitado sem explicação.
 */
export async function simularCampanhaAction(
  input: unknown,
): Promise<ActionResult<{ campanha: Tables<'campanhas'>; aviso?: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const c = await salvarCampanha(supabase, input)
    const r = await dispararSimularCampanha(c.id)
    revalidar(c.id)
    return {
      ok: true,
      data: { campanha: c, aviso: r.ok ? undefined : r.message },
    }
  } catch (e) {
    return falha(e)
  }
}

export async function aprovarCampanhaAction(
  input: unknown,
): Promise<ActionResult<Tables<'campanhas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const c = await aprovarCampanha(supabase, input)
    // Não espera o cron: quem aprovou quer ver a campanha começar. O executor é
    // single-flight, então um disparo a mais não atropela nada.
    await dispararExecutarCampanhas()
    revalidar(c.id)
    return { ok: true, data: c }
  } catch (e) {
    return falha(e)
  }
}

export async function pausarCampanhaAction(
  input: unknown,
): Promise<ActionResult<Tables<'campanhas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const c = await pausarCampanha(supabase, input)
    revalidar(c.id)
    return { ok: true, data: c }
  } catch (e) {
    return falha(e)
  }
}

export async function retomarCampanhaAction(
  input: unknown,
): Promise<ActionResult<Tables<'campanhas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const c = await retomarCampanha(supabase, input)
    await dispararExecutarCampanhas()
    revalidar(c.id)
    return { ok: true, data: c }
  } catch (e) {
    return falha(e)
  }
}

export async function cancelarCampanhaAction(
  input: unknown,
): Promise<ActionResult<Tables<'campanhas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const c = await cancelarCampanha(supabase, input)
    revalidar(c.id)
    return { ok: true, data: c }
  } catch (e) {
    return falha(e)
  }
}
