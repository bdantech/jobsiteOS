'use server'

import { revalidatePath } from 'next/cache'
import { acaoNoMandato, criarMandato, decidirProposta, type Json } from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { ActionResult } from './empresas'

/**
 * Mutações da operação dos Agentes (Prompt 09 §11.1–§11.2): criar mandato manual, as
 * ações humanas sobre um mandato e a decisão sobre uma proposta de mandato.
 *
 * O client é o do USUÁRIO, nunca o de service role. As RPCs (0270d) são SECURITY DEFINER
 * e começam pela guarda do módulo — e, onde é o caso, pela de gestor. É essa guarda que
 * impede um closer de encerrar o mandato de outro; a tela só evita oferecer o botão.
 * Passar o admin aqui anularia a única autorização que existe.
 *
 * A checagem de módulo abaixo é a camada de MENSAGEM: devolve "sem acesso" antes de uma
 * ida ao banco que voltaria com o mesmo erro em forma de exceção.
 */

async function autorizar() {
  const context = await getSessionContext()
  if (!context) {
    return {
      erro: { ok: false as const, message: 'Sessão expirada.', code: 'auth' },
      supabase: null,
      context: null,
    }
  }
  if (!context.grantedModuleIds.includes('agentes')) {
    return {
      erro: { ok: false as const, message: 'Sem acesso ao módulo Agentes.', code: 'forbidden' },
      supabase: null,
      context: null,
    }
  }
  return { erro: null, supabase: await createClient(), context }
}

function falha(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
  return { ok: false, message, code: 'unknown' }
}

/**
 * As duas telas de operação. O layout é o mesmo, mas `revalidatePath` com 'layout' pegaria
 * também Personas e Configurações, que são de outra frente e não mudam com um mandato.
 */
function revalidarOperacao() {
  revalidatePath('/agentes')
  revalidatePath('/agentes/mandatos')
}

export async function criarMandatoAction(input: unknown): Promise<ActionResult<{ id: string; codigo: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const m = await criarMandato(supabase, input)
    revalidarOperacao()
    return { ok: true, data: { id: m.id, codigo: m.codigo } }
  } catch (e) {
    return falha(e)
  }
}

export async function acaoNoMandatoAction(input: unknown): Promise<ActionResult<{ id: string; estado: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const m = await acaoNoMandato(supabase, input)
    revalidarOperacao()
    return { ok: true, data: { id: m.id, estado: m.estado } }
  } catch (e) {
    return falha(e)
  }
}

export async function decidirPropostaAction(
  input: unknown,
): Promise<ActionResult<{ id: string; estado: string; mandatoCriadoId: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const p = await decidirProposta(supabase, input)
    revalidarOperacao()
    return { ok: true, data: { id: p.id, estado: p.estado, mandatoCriadoId: p.mandato_criado_id } }
  } catch (e) {
    return falha(e)
  }
}

// ─── Leituras que o navegador não consegue fazer sozinho ────────────────────

export interface PermissoesAgentes {
  /** Tem o módulo `agentes` no perfil. */
  modulo: boolean
  /** Admin ou gestor comercial (`app_agentes_gestor`). */
  gestor: boolean
}

/**
 * "Posso delegar ao agente?" — pergunta feita por telas de OUTROS módulos (empresa, card
 * de NF, funil comercial), que não recebem os módulos da sessão por prop. O perfil só é
 * legível no servidor (ver `lib/auth.ts`), então a resposta vem daqui, uma vez por sessão
 * (a tela guarda com `staleTime: Infinity`).
 */
export async function permissoesAgentesAction(): Promise<PermissoesAgentes> {
  const context = await getSessionContext()
  if (!context || !context.grantedModuleIds.includes('agentes')) return { modulo: false, gestor: false }
  const supabase = await createClient()
  const { data } = await supabase.rpc('app_agentes_gestor')
  return { modulo: true, gestor: data === true }
}

export interface AgenteVisivel {
  id: string
  nome: string
  tipo: string
  ativo: boolean
  autonomo: boolean
  pausado_em: string | null
  pausado_motivo: string | null
  whatsapp_conta_id: string | null
  closer_id: string | null
  modo_rodagem: string
  persona: Json | null
  limites: Json | null
}

/**
 * Os vendedores de IA que ESTE usuário acompanha.
 *
 * ── POR QUE SERVICE ROLE ───────────────────────────────────────────────────
 * `vendedores` é lido pela régua do módulo Comercial (0091). Um closer com Agentes e sem
 * Comercial leria zero agentes — e o Ao vivo diria "nenhum agente cadastrado" com três
 * agentes trabalhando. A lista de QUAIS agentes vem de `app_agentes_visiveis()`, chamada
 * com o client do USUÁRIO: é ela que autoriza. O admin só busca as colunas desses ids, e
 * só as de operação (nada de escopo, caixa de e-mail ou conta de voz).
 */
export async function listarAgentesAction(): Promise<AgenteVisivel[]> {
  const context = await getSessionContext()
  if (!context || !context.grantedModuleIds.includes('agentes')) return []
  const supabase = await createClient()
  const { data: ids, error } = await supabase.rpc('app_agentes_visiveis')
  if (error) throw new Error(error.message)
  if (!ids || ids.length === 0) return []

  // prettier-ignore
  const { data, error: e2 } = await createAdminClient()
    .from('vendedores')
    .select('id, nome, tipo, ativo, autonomo, pausado_em, pausado_motivo, whatsapp_conta_id, closer_id, modo_rodagem, persona, limites')
    .in('id', ids)
    .eq('is_ia', true)
    .order('nome')
  if (e2) throw new Error(e2.message)
  return data ?? []
}
