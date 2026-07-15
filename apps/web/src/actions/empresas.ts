'use server'

import { revalidatePath } from 'next/cache'
import {
  MutationError,
  atualizarEmpresa,
  canAccessRoute,
  criarEmpresa,
  criarNota,
  type FieldErrors,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * Mutations for the `empresas` module.
 *
 * Every one of them goes through the write helpers in @jobsiteos/core, which
 * call the SECURITY INVOKER functions from migration 0008 — row + empresa_eventos
 * + audit_log in a single transaction. Never write these tables directly.
 *
 * The client passed to the helpers is deliberately the USER-SCOPED one
 * (lib/supabase/server), never the admin one: the functions run as the caller,
 * so RLS decides what they may touch and audit_log.usuario_id = auth.uid().
 */

/**
 * Server actions cannot throw across the RSC boundary with a usable payload, so
 * failures come back as data. This mirrors MutationError one-to-one, which is
 * what lets a form re-attach `fieldErrors` to the exact input that produced them
 * (duplicate CNPJ -> "CNPJ já cadastrado." under the CNPJ field).
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

/** Not authenticated / not granted the module: same shape as any other failure. */
const SEM_SESSAO = {
  ok: false as const,
  message: 'Sua sessão expirou. Entre novamente para continuar.',
  code: 'forbidden',
}

const SEM_MODULO = {
  ok: false as const,
  message: 'Você não tem acesso ao módulo Empresas.',
  code: 'forbidden',
}

/**
 * Authorize, then hand back the user-scoped client.
 *
 * RLS would already stop an unauthorized write (app_tem_modulo('empresas')), but
 * failing here turns a raw 42501 into a sentence a user can read, and keeps the
 * check in the same place the sidebar and the AI tool list read from: the registry.
 */
type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }
type Autorizacao =
  | { erro: Falha; supabase: null }
  | { erro: null; supabase: Awaited<ReturnType<typeof createClient>> }

async function autorizar(): Promise<Autorizacao> {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO, supabase: null }
  if (!canAccessRoute('/empresas', context.grantedModuleIds)) {
    return { erro: SEM_MODULO, supabase: null }
  }

  return { erro: null, supabase: await createClient() }
}

function falha(error: unknown): Falha {
  if (error instanceof MutationError) {
    return {
      ok: false,
      message: error.message,
      code: error.code,
      fieldErrors: error.fieldErrors,
    }
  }
  // Anything else is a bug or an outage — never leak the raw message to the UI.
  console.error('[empresas] erro inesperado na mutação', error)
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

export async function criarEmpresaAction(
  input: unknown,
): Promise<ActionResult<Tables<'empresas'>>> {
  const auth = await autorizar()
  if (auth.erro) return auth.erro

  try {
    const empresa = await criarEmpresa(auth.supabase, input)
    revalidatePath('/empresas')
    return { ok: true, data: empresa }
  } catch (error) {
    return falha(error)
  }
}

/**
 * The ONLY way estagio changes. app_atualizar_empresa emits the
 * `estagio.alterado` event when (and only when) the value actually differs, so
 * the Company 360 timeline and the notification fan-out both stay honest.
 */
export async function atualizarEmpresaAction(
  input: unknown,
): Promise<ActionResult<Tables<'empresas'>>> {
  const auth = await autorizar()
  if (auth.erro) return auth.erro

  try {
    const empresa = await atualizarEmpresa(auth.supabase, input)
    revalidatePath('/empresas')
    revalidatePath(`/empresas/${empresa.id}`)
    return { ok: true, data: empresa }
  } catch (error) {
    return falha(error)
  }
}

export async function criarNotaAction(
  input: unknown,
): Promise<ActionResult<Tables<'empresa_notas'>>> {
  const auth = await autorizar()
  if (auth.erro) return auth.erro

  try {
    const nota = await criarNota(auth.supabase, input)
    revalidatePath(`/empresas/${nota.empresa_id}`)
    return { ok: true, data: nota }
  } catch (error) {
    return falha(error)
  }
}
