'use server'

import { revalidatePath } from 'next/cache'
import {
  CONFIG_CHAVES,
  MutationError,
  ativarCamadaRegra,
  canAccessRoute,
  definirConfig,
  promocaoCamadaSchema,
  salvarCamadaRegra,
  type FieldErrors,
  type PromocaoCamada,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext, isAdmin, type SessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dispararReclassificacao } from '@/lib/mercado/worker'

/**
 * Mutations for the pyramid rules (§5.1).
 *
 * A camada rule reclassifies the ENTIRE universe. It is the one lever in this
 * module that silently rewrites every number the commercial team plans against,
 * so authoring is admin-only — enforced three times over, on purpose:
 *   1. the page redirects a non-admin (defence in depth, not the gate);
 *   2. every action here re-checks with requireAdmin() BEFORE it acts;
 *   3. RLS refuses the write anyway (policy camada_regras_admin, migration 0012).
 * Only (3) is load-bearing. (2) exists so the failure is a sentence a human can
 * read instead of a raw 42501, and so the check lives where the sidebar and the
 * AI tool list also read it from: the registry.
 *
 * The write helpers get the USER-SCOPED client, never the admin one: they are
 * SECURITY INVOKER, so handing them the service role would switch RLS off and
 * stamp audit_log.usuario_id with nothing.
 */

// ─── Envelope ───────────────────────────────────────────────────────────────

/**
 * `aviso` is a success that came with a caveat — the rule IS active, but the
 * worker did not pick up the reclassification. Folding that into `ok: false`
 * would be a lie (the write happened, and it is not undone by a failed HTTP
 * call), and dropping it would leave the pyramid quietly stale.
 */
export type ActionResult<T> =
  | { ok: true; data: T; aviso?: string }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = {
  ok: false,
  message: 'Sua sessão expirou. Entre novamente para continuar.',
  code: 'forbidden',
}

const SEM_MODULO: Falha = {
  ok: false,
  message: 'Você não tem acesso ao módulo Mercado.',
  code: 'forbidden',
}

const SEM_ADMIN: Falha = {
  ok: false,
  message: 'Apenas administradores podem alterar as regras da pirâmide.',
  code: 'forbidden',
}

type Autorizacao =
  | { erro: Falha; supabase: null; context: null }
  | { erro: null; supabase: Awaited<ReturnType<typeof createClient>>; context: SessionContext }

async function autorizar(): Promise<Autorizacao> {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO, supabase: null, context: null }
  if (!canAccessRoute('/mercado', context.grantedModuleIds)) {
    return { erro: SEM_MODULO, supabase: null, context: null }
  }
  if (!isAdmin(context)) return { erro: SEM_ADMIN, supabase: null, context: null }

  return { erro: null, supabase: await createClient(), context }
}

function falha(error: unknown): Falha {
  if (error instanceof MutationError) {
    return { ok: false, message: error.message, code: error.code, fieldErrors: error.fieldErrors }
  }
  console.error('[mercado/regras] erro inesperado na mutação', error)
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

// ─── Camada de promoção (§5.1) ──────────────────────────────────────────────

/**
 * The promotion threshold lives in `app_config` (migration 0016), whose policy
 * is admin-write / everyone-read. That policy IS the authorization: the write
 * below goes through the user-scoped client on purpose, so a non-admin caller is
 * refused by Postgres, not merely by the requireAdmin() above it.
 *
 * It used to be event-sourced out of `audit_log`, which any active user may
 * append to — so the read had to re-derive "was the author an admin?" in
 * application code. That derivation is gone: there is now exactly one row, and
 * one policy, that decide this value.
 */
export async function definirCamadaPromocaoAction(
  input: unknown,
): Promise<ActionResult<PromocaoCamada>> {
  const auth = await autorizar()
  if (auth.erro) return auth.erro

  const parsed = promocaoCamadaSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: 'Camada de promoção inválida.', code: 'validation' }
  }

  try {
    await definirConfig(auth.supabase, {
      chave: CONFIG_CHAVES.MERCADO_PROMOCAO_CAMADA,
      valor: parsed.data,
    })
  } catch (error) {
    return falha(error)
  }

  revalidatePath('/mercado/piramide')
  return { ok: true, data: parsed.data }
}

// ─── Disparo do worker ──────────────────────────────────────────────────────

/**
 * Wakes the worker up to reclassify the universe under the rule that was just
 * activated. The HTTP call itself lives in `@/lib/mercado/worker` — the ONE
 * server-only module that holds WORKER_SECRET, shared with the cron routes and the
 * Ingestões action, so the token has a single code path.
 *
 * A failure here is NOT a failed activation: the rule is already active and the run
 * can be retried from Ingestões. So it comes back as an `aviso` (a caveat on a
 * success), never as an error — folding it into `ok: false` would be a lie, and
 * dropping it would leave the pyramid quietly stale.
 */
async function avisarReclassificacao(input: {
  camada: string
  regraId: string
  versao: number
}): Promise<string | null> {
  const resultado = await dispararReclassificacao(input)
  if (resultado.ok) return null

  const cauda = 'Reexecute a reclassificação em Ingestões.'
  return resultado.code === 'config'
    ? `A regra foi salva e ativada, mas o worker não está configurado. O universo só será reclassificado quando a reclassificação for executada em Ingestões.`
    : `A regra foi ativada, mas a reclassificação não começou: ${resultado.message} ${cauda}`
}

// ─── Regras ─────────────────────────────────────────────────────────────────

/**
 * Saves the NEXT version of a layer rule — never edits one. A rule that could be
 * edited in place would make `mercado_universo.camada_regra_versao` a lie: it
 * would point at a rule whose text has since changed, and "what moved this
 * company?" becomes unanswerable.
 */
export async function salvarCamadaRegraAction(
  input: unknown,
): Promise<ActionResult<Tables<'camada_regras'>>> {
  const auth = await autorizar()
  if (auth.erro) return auth.erro

  try {
    const regra = await salvarCamadaRegra(auth.supabase, input)

    let aviso: string | null = null
    if (regra.ativa) {
      aviso = await avisarReclassificacao({
        camada: regra.camada,
        regraId: regra.id,
        versao: regra.versao,
      })
    }

    revalidatePath('/mercado/piramide')
    return aviso ? { ok: true, data: regra, aviso } : { ok: true, data: regra }
  } catch (error) {
    return falha(error)
  }
}

/** Rolls back to (or forward to) an existing version. Same reclassification. */
export async function ativarCamadaRegraAction(
  input: unknown,
): Promise<ActionResult<Tables<'camada_regras'>>> {
  const auth = await autorizar()
  if (auth.erro) return auth.erro

  try {
    const regra = await ativarCamadaRegra(auth.supabase, input)

    const aviso = await avisarReclassificacao({
      camada: regra.camada,
      regraId: regra.id,
      versao: regra.versao,
    })

    revalidatePath('/mercado/piramide')
    return aviso ? { ok: true, data: regra, aviso } : { ok: true, data: regra }
  } catch (error) {
    return falha(error)
  }
}
