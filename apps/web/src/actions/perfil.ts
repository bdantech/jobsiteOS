'use server'

import { revalidatePath } from 'next/cache'
import {
  MutationError,
  canAccessRoute,
  registrarSugestao,
  salvarPerfilConfig,
  vincularVersaoSugestao,
  type FieldErrors,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dispararPerfilRecalcular } from '@/lib/mercado/worker'

/**
 * Mutações do Perfil de Quem Opera (04f).
 *
 * NENHUMA delas ativa regra. O um-clique registra a decisão e devolve o id do
 * log; quem cria a versão continua sendo o editor de regras, com preview de
 * impacto e ativação humana — o mesmo caminho de sempre.
 *
 * Isso não é excesso de cerimônia: uma regra de camada reclassifica ~2M linhas e
 * reescreve todos os números contra os quais o comercial planeja. Um botão que
 * fizesse isso a partir de um card seria a coisa mais cara de desfazer no sistema.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = { ok: false, message: 'Sua sessão expirou. Entre novamente.', code: 'forbidden' }
const SEM_MODULO: Falha = {
  ok: false,
  message: 'Você não tem acesso ao módulo Mercado.',
  code: 'forbidden',
}

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null }
  if (!canAccessRoute('/mercado', context.grantedModuleIds)) {
    return { erro: SEM_MODULO as Falha, supabase: null }
  }
  return { erro: null, supabase: await createClient() }
}

function falhaDe(error: unknown): Falha {
  if (error instanceof MutationError) {
    return { ok: false, message: error.message, code: error.code, fieldErrors: error.fieldErrors }
  }
  console.error('[perfil] erro inesperado na mutação', error)
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

/**
 * Aceitar ou descartar uma sugestão.
 *
 * O RPC lê a árvore proposta DO SNAPSHOT, e não do que o browser mandou — o log
 * precisa ser evidência do que o cálculo realmente propôs, não um campo que
 * alguém preenche.
 */
export async function registrarSugestaoAction(
  input: unknown,
): Promise<ActionResult<Tables<'perfil_sugestoes_log'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const log = await registrarSugestao(supabase, input)
    revalidatePath('/mercado/perfil')
    return { ok: true, data: log }
  } catch (e) {
    return falhaDe(e)
  }
}

/** Fecha o ciclo: a versão que o editor criou a partir da sugestão aceita. */
export async function vincularVersaoSugestaoAction(
  input: unknown,
): Promise<ActionResult<Tables<'perfil_sugestoes_log'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const log = await vincularVersaoSugestao(supabase, input)
    revalidatePath('/mercado/perfil')
    return { ok: true, data: log }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function salvarPerfilConfigAction(
  input: unknown,
): Promise<ActionResult<Tables<'perfil_config'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const c = await salvarPerfilConfig(supabase, input)
    revalidatePath('/mercado/perfil')
    return { ok: true, data: c }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function recalcularPerfilAction(): Promise<
  ActionResult<{ enfileirado: boolean; aviso?: string }>
> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await dispararPerfilRecalcular()
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}
