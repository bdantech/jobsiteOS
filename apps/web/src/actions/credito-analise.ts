'use server'

import { revalidatePath } from 'next/cache'
import {
  MutationError,
  canAccessRoute,
  editarParecer,
  registrarDecisaoCredito,
  revisarExtracao,
  rodarAnalisePropria,
  salvarParametrosAnalise,
  type FieldErrors,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dispararAnalisePropria } from '@/lib/mercado/worker'

/**
 * Mutações da análise proprietária (04j).
 *
 * NENHUMA delas calcula, extrai ou decide por conta própria:
 * - `rodar` abre o registro pelo RPC e ACORDA o worker; o trabalho é lá.
 * - `revisar` grava a confirmação humana e acorda o worker de novo, agora para o cálculo.
 * - `decidir` grava a decisão de uma pessoa; o RPC recusa divergência sem motivo.
 *
 * O disparo do worker é best-effort: se ele estiver fora do ar, a análise fica em
 * `processando` e o cron diário (`/api/cron/credito-reanalises`) a retoma. Falhar a
 * action por causa disso perderia o registro que já foi gravado.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = { ok: false, message: 'Sua sessão expirou. Entre novamente.', code: 'forbidden' }
const SEM_MODULO: Falha = {
  ok: false,
  message: 'Análise de crédito proprietária é do perfil Crédito.',
  code: 'forbidden',
}

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null }
  if (!canAccessRoute('/credito', context.grantedModuleIds)) return { erro: SEM_MODULO as Falha, supabase: null }
  return { erro: null, supabase: await createClient() }
}

function falhaDe(e: unknown): Falha {
  if (e instanceof MutationError) return { ok: false, message: e.message, code: e.code, fieldErrors: e.fieldErrors }
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

export interface AnaliseDisparada {
  analise: Tables<'analises_proprietarias'>
  /** false = o worker não atendeu; o cron retoma. A tela precisa dizer isso. */
  worker_acordado: boolean
}

/**
 * Ação PAGA: cada corrida relê os documentos no modelo. O botão que chama isto pergunta
 * antes, e o RPC recusa uma segunda análise enquanto houver uma em andamento.
 */
export async function rodarAnalisePropriaAction(input: unknown): Promise<ActionResult<AnaliseDisparada>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const a = await rodarAnalisePropria(supabase, input)
    const r = await dispararAnalisePropria(a.id)
    revalidatePath(`/credito/analises/${a.analise_credito_id}`)
    return { ok: true, data: { analise: a, worker_acordado: r.ok } }
  } catch (e) {
    return falhaDe(e)
  }
}

/** Confirma a extração e devolve a análise ao worker — agora para o cálculo e o parecer. */
export async function revisarExtracaoAction(input: unknown): Promise<ActionResult<AnaliseDisparada>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const a = await revisarExtracao(supabase, input)
    const r = await dispararAnalisePropria(a.id)
    revalidatePath(`/credito/analises/${a.analise_credito_id}`)
    return { ok: true, data: { analise: a, worker_acordado: r.ok } }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function editarParecerAction(
  input: unknown,
): Promise<ActionResult<Tables<'analises_proprietarias'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const a = await editarParecer(supabase, input)
    revalidatePath(`/credito/analises/${a.analise_credito_id}`)
    return { ok: true, data: a }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * A decisão. Só perfil Crédito, nunca automática, nunca pela IA — e o motivo é
 * obrigatório em tudo que não seja o caminho trivial do quadrante.
 */
export async function registrarDecisaoAction(
  input: unknown,
): Promise<ActionResult<Tables<'analises_proprietarias'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const a = await registrarDecisaoCredito(supabase, input)
    revalidatePath(`/credito/analises/${a.analise_credito_id}`)
    revalidatePath('/credito')
    return { ok: true, data: a }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * Nova versão de parâmetros. Não recalcula nada retroativamente, e isso é deliberado:
 * uma análise já concluída aponta para a versão com que foi feita, e reescrevê-la
 * apagaria o número que alguém defendeu num comitê.
 */
export async function salvarParametrosAction(
  input: unknown,
): Promise<ActionResult<Tables<'analise_parametros'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const v = await salvarParametrosAnalise(supabase, input)
    revalidatePath('/credito/parametros')
    return { ok: true, data: v }
  } catch (e) {
    return falhaDe(e)
  }
}
