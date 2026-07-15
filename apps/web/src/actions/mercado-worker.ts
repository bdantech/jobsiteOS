'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { canAccessRoute, FONTE_INGESTAO_LABELS } from '@jobsiteos/core'
import { getSessionContext, isAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dispararJob, type JobWorker } from '@/lib/mercado/worker'

/**
 * The admin trigger for the Mercado worker (Receita CNPJ + CNO).
 *
 * ─── SECURITY ────────────────────────────────────────────────────────────────
 * Every export of a 'use server' module is a public RPC endpoint. So this file
 * exports exactly ONE function, and its first statement is the admin check.
 * WORKER_URL / WORKER_SECRET never leave the server: the client component calls
 * this action and gets back nothing but a pt-BR sentence.
 *
 * ─── THE RULES ARE ENFORCED HERE, NOT IN THE UI ─────────────────────────────
 * The disabled state of "Reexecutar com fallback" is a courtesy. These are the
 * actual invariants, re-checked against the database on every call:
 *
 *   1. Only an admin (perfil with the `admin` module) may trigger anything.
 *   2. The fallback mirror is NEVER automatic (spec §3.1). It requires an
 *      explicit reference to a run of the SAME fonte whose status is `falhou`.
 *   3. One run per fonte at a time — a second Receita job while the first is
 *      still streaming multi-GB dumps would fight it for the staging tables.
 *
 * mercado_ingestoes is SELECT-only for `authenticated` (migration 0012), so the
 * checks below use the USER-SCOPED client and stay under RLS. The worker itself
 * writes the row with the service role, on its side.
 */

export type ExecucaoResult = { ok: true; message: string } | { ok: false; message: string }

const dispararSchema = z.object({
  fonte: z.enum(['receita_cnpj', 'cno'] as const satisfies readonly JobWorker[]),
  fallback: z.boolean(),
  /** Required when fallback is true: the failed run being re-run. */
  reexecucao_de: z.string().uuid().optional(),
})

/**
 * Triggers `/jobs/receita` or `/jobs/cno` on the worker.
 *
 * Used by "Executar agora", "Reexecutar" (fallback: false) and "Reexecutar com
 * fallback" (fallback: true) — one endpoint, because they differ only in a flag
 * and share every authorization rule.
 */
export async function dispararIngestaoAction(input: unknown): Promise<ExecucaoResult> {
  const context = await getSessionContext()
  if (!context) {
    return { ok: false, message: 'Sua sessão expirou. Entre novamente para continuar.' }
  }
  if (!canAccessRoute('/mercado', context.grantedModuleIds) || !isAdmin(context)) {
    return { ok: false, message: 'Apenas administradores podem executar ingestões.' }
  }

  const parsed = dispararSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: 'Parâmetros inválidos para a execução.' }
  }
  const { fonte, fallback, reexecucao_de } = parsed.data

  const supabase = await createClient()

  // Invariant 3 — no concurrent run for the same source.
  const { data: emAndamento, error: erroAndamento } = await supabase
    .from('mercado_ingestoes')
    .select('id')
    .eq('fonte', fonte)
    .eq('status', 'executando')
    .limit(1)

  if (erroAndamento) {
    console.error('[mercado] falha ao checar execuções em andamento', erroAndamento.message)
    return { ok: false, message: 'Não foi possível verificar as execuções em andamento.' }
  }
  if (emAndamento && emAndamento.length > 0) {
    return {
      ok: false,
      message: `Já existe uma execução em andamento para ${FONTE_INGESTAO_LABELS[fonte]}. Aguarde ela terminar.`,
    }
  }

  // Invariant 2 — the fallback mirror only exists to rescue a run that failed.
  if (fallback) {
    if (!reexecucao_de) {
      return {
        ok: false,
        message: 'O fallback só pode ser usado a partir de uma execução que falhou.',
      }
    }

    const { data: origem, error: erroOrigem } = await supabase
      .from('mercado_ingestoes')
      .select('id, fonte, status')
      .eq('id', reexecucao_de)
      .maybeSingle()

    if (erroOrigem) {
      console.error('[mercado] falha ao carregar a execução de origem', erroOrigem.message)
      return { ok: false, message: 'Não foi possível carregar a execução de origem.' }
    }
    if (!origem) {
      return { ok: false, message: 'Execução de origem não encontrada.' }
    }
    if (origem.fonte !== fonte) {
      return { ok: false, message: 'A execução de origem é de outra fonte.' }
    }
    if (origem.status !== 'falhou') {
      return {
        ok: false,
        message: 'O fallback só está disponível para execuções que falharam.',
      }
    }
  }

  const resultado = await dispararJob({
    job: fonte,
    origem: 'admin',
    fallback,
    reexecucaoDe: reexecucao_de,
  })

  if (!resultado.ok) return { ok: false, message: resultado.message }

  revalidatePath('/mercado/ingestoes')

  return {
    ok: true,
    message: fallback
      ? `Reexecução com fallback disparada para ${FONTE_INGESTAO_LABELS[fonte]}.`
      : `Execução disparada para ${FONTE_INGESTAO_LABELS[fonte]}.`,
  }
}
