'use server'

import { revalidatePath } from 'next/cache'
import {
  MutationError,
  aprovarLote,
  cancelarLote,
  canAccessRoute,
  criarLote,
  removerSupressao,
  salvarRadarConfig,
  suprimir,
  type FieldErrors,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dispararLoteRadar } from '@/lib/mercado/worker'

/**
 * Mutações do módulo Radar. Todas pelos write helpers de @jobsiteos/core (RPCs
 * SECURITY INVOKER da migração 0029, com audit_log), sempre com o client do USUÁRIO
 * (o RLS decide o que a escrita toca). A execução de lote é enfileirada no worker.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = { ok: false, message: 'Sua sessão expirou. Entre novamente.', code: 'forbidden' }
const SEM_MODULO: Falha = { ok: false, message: 'Você não tem acesso ao módulo Radar.', code: 'forbidden' }

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null }
  if (!canAccessRoute('/radar', context.grantedModuleIds)) return { erro: SEM_MODULO as Falha, supabase: null }
  return { erro: null, supabase: await createClient() }
}

function falhaDe(e: unknown): Falha {
  if (e instanceof MutationError) return { ok: false, message: e.message, code: e.code, fieldErrors: e.fieldErrors }
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

export async function criarLoteAction(input: unknown): Promise<ActionResult<Tables<'lotes_enriquecimento'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const lote = await criarLote(supabase, input)
    // Notifica os aprovadores (Admin) — best-effort: uma falha aqui não desfaz o lote.
    if (lote.status === 'aguardando_aprovacao') {
      await supabase.from('empresa_eventos').insert({
        empresa_id: null,
        tipo: 'lote.aguardando_aprovacao',
        ator_usuario_id: null,
        payload: {
          titulo: 'Lote aguardando aprovação',
          resumo: `Lote de ${lote.tipo} pronto para aprovação${lote.nome ? `: ${lote.nome}` : ''}.`,
          url: `/radar/lotes/${lote.id}`,
        } as never,
      })
    }
    revalidatePath('/radar/lotes')
    return { ok: true, data: lote }
  } catch (e) {
    return falhaDe(e)
  }
}

/** Aprova o lote e JÁ o enfileira no worker (aprovar → aprovado → worker consome). */
export async function aprovarLoteAction(id: string): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    await aprovarLote(supabase, { id })
  } catch (e) {
    return falhaDe(e)
  }
  const disparo = await dispararLoteRadar(id)
  revalidatePath(`/radar/lotes/${id}`)
  revalidatePath('/radar/lotes')
  // Aprovado com sucesso; se o worker não aceitou, o lote fica 'aprovado' e dá pra re-disparar.
  return {
    ok: true,
    data: { enfileirado: disparo.ok, aviso: disparo.ok ? undefined : disparo.message },
  }
}

export async function executarLoteAction(id: string): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro
  const disparo = await dispararLoteRadar(id)
  revalidatePath(`/radar/lotes/${id}`)
  return { ok: true, data: { enfileirado: disparo.ok, aviso: disparo.ok ? undefined : disparo.message } }
}

export async function cancelarLoteAction(id: string): Promise<ActionResult<Tables<'lotes_enriquecimento'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const lote = await cancelarLote(supabase, { id })
    revalidatePath(`/radar/lotes/${id}`)
    revalidatePath('/radar/lotes')
    return { ok: true, data: lote }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function suprimirAction(input: unknown): Promise<ActionResult<Tables<'supressao'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const sup = await suprimir(supabase, input)
    revalidatePath('/radar/supressao')
    return { ok: true, data: sup }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function removerSupressaoAction(id: string): Promise<ActionResult<null>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    await removerSupressao(supabase, { id })
    revalidatePath('/radar/supressao')
    return { ok: true, data: null }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function salvarConfigAction(input: unknown): Promise<ActionResult<Tables<'radar_config'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const cfg = await salvarRadarConfig(supabase, input)
    revalidatePath('/radar/config')
    return { ok: true, data: cfg }
  } catch (e) {
    return falhaDe(e)
  }
}
