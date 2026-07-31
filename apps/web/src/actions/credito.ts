'use server'

import { revalidatePath } from 'next/cache'
import {
  MutationError,
  ativarScorecardVersao,
  canAccessRoute,
  moverAnalise,
  registrarDocAnalise,
  salvarCreditoConfig,
  salvarScorecardVersao,
  solicitarAnalise,
  type FieldErrors,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  dispararBackfillAtradius,
  dispararCreditoMensal,
  dispararEnviarAnalises,
  dispararEstimarPotencial,
  dispararPollDecisoes,
  dispararRecalcularScores,
  dispararSyncAtradius,
} from '@/lib/mercado/worker'

/**
 * Mutações do módulo Crédito. Escrita sempre pelos RPCs SECURITY DEFINER da migração
 * 0073, com o client do USUÁRIO — o RLS e o próprio RPC decidem o que a escrita toca.
 *
 * NENHUMA action aqui aprova, nega ou expira uma análise. Esses estágios são do worker,
 * com service role: um atalho de tela para "aprovada" produziria um limite que a apólice
 * da seguradora não conhece, e ele apareceria na Company 360 com cara de fato.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = { ok: false, message: 'Sua sessão expirou. Entre novamente.', code: 'forbidden' }
const SEM_MODULO: Falha = { ok: false, message: 'Você não tem acesso ao módulo Crédito.', code: 'forbidden' }

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null }
  if (!canAccessRoute('/credito', context.grantedModuleIds)) return { erro: SEM_MODULO as Falha, supabase: null }
  return { erro: null, supabase: await createClient() }
}

/**
 * Solicitar é a única escrita que Empresas também pode fazer: o pedido nasce na Company
 * 360, e exigir o módulo Crédito ali deixaria o vendedor sem o botão que ele precisa
 * apertar. O RPC repete a checagem — esta é a camada de mensagem, não a de segurança.
 */
async function autorizarSolicitacao() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null }
  const pode =
    canAccessRoute('/credito', context.grantedModuleIds) ||
    canAccessRoute('/empresas', context.grantedModuleIds)
  if (!pode) return { erro: SEM_MODULO as Falha, supabase: null }
  return { erro: null, supabase: await createClient() }
}

function falhaDe(e: unknown): Falha {
  if (e instanceof MutationError) return { ok: false, message: e.message, code: e.code, fieldErrors: e.fieldErrors }
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

export async function solicitarAnaliseAction(
  input: unknown,
): Promise<ActionResult<Tables<'analises_credito'>>> {
  const { erro, supabase } = await autorizarSolicitacao()
  if (erro) return erro
  try {
    const a = await solicitarAnalise(supabase, input)
    revalidatePath('/credito')
    revalidatePath(`/empresas/${a.empresa_id}`)
    return { ok: true, data: a }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function moverAnaliseAction(
  input: unknown,
): Promise<ActionResult<Tables<'analises_credito'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const a = await moverAnalise(supabase, input)
    revalidatePath('/credito')
    revalidatePath(`/credito/analises/${a.id}`)
    return { ok: true, data: a }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function registrarDocAction(input: unknown): Promise<ActionResult<Tables<'analise_docs'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const d = await registrarDocAnalise(supabase, input)
    revalidatePath(`/credito/analises/${d.analise_id}`)
    return { ok: true, data: d }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * Enviar à seguradora. Ação PAGA: é o único caminho que resolve um buyer novo na
 * Atradius. Recebe ids EXPLÍCITOS — nunca "todas as solicitadas" — porque um envio em
 * massa acidental é uma fatura, não um incômodo.
 */
export async function enviarAnalisesAction(
  analiseIds: string[],
): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro
  if (!analiseIds.length) {
    return { ok: false, message: 'Selecione ao menos uma análise para enviar.', code: 'invalid' }
  }
  const r = await dispararEnviarAnalises(analiseIds)
  revalidatePath('/credito')
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

export async function salvarScorecardAction(
  input: unknown,
): Promise<ActionResult<Tables<'scorecard_versoes'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const v = await salvarScorecardVersao(supabase, input)
    revalidatePath('/credito/scorecard')
    return { ok: true, data: v }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * Ativar uma versão JÁ dispara o recálculo. Ativar sem recalcular deixaria a base inteira
 * com os scores da versão anterior enquanto a tela mostra a nova como vigente — a mesma
 * armadilha da pirâmide (§5.1) e do funil de faixas.
 */
export async function ativarScorecardAction(
  input: unknown,
): Promise<ActionResult<{ versao: Tables<'scorecard_versoes'>; recalculo: boolean; aviso?: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const v = await ativarScorecardVersao(supabase, input)
    const r = await dispararRecalcularScores()
    revalidatePath('/credito/scorecard')
    revalidatePath('/credito')
    return { ok: true, data: { versao: v, recalculo: r.ok, aviso: r.ok ? undefined : r.message } }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function salvarCreditoConfigAction(
  input: unknown,
): Promise<ActionResult<Tables<'credito_config'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const c = await salvarCreditoConfig(supabase, input)
    revalidatePath('/credito/config')
    return { ok: true, data: c }
  } catch (e) {
    return falhaDe(e)
  }
}

type Disparo = ActionResult<{ enfileirado: boolean; aviso?: string }>

async function disparar(fn: () => Promise<{ ok: boolean; message?: string }>): Promise<Disparo> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await fn()
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

/** Calibrar + pontuar + calcular potencial, nesta ordem. */
export const rodarCreditoMensalAction = async (): Promise<Disparo> => disparar(dispararCreditoMensal)
/** Só reaplica os coeficientes vigentes sobre o potencial. */
export const reestimarPotencialAction = async (): Promise<Disparo> => disparar(dispararEstimarPotencial)
export const recalcularScoresAction = async (): Promise<Disparo> => disparar(dispararRecalcularScores)
export const pollDecisoesAction = async (): Promise<Disparo> => disparar(dispararPollDecisoes)
export const syncAtradiusAction = async (): Promise<Disparo> => disparar(dispararSyncAtradius)
/** Backfill do histórico da apólice. Roda uma vez; não descobre buyer novo. */
export const backfillAtradiusAction = async (): Promise<Disparo> => disparar(dispararBackfillAtradius)
