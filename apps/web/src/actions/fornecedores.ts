'use server'

import { revalidatePath } from 'next/cache'
import {
  descartarFornecedor,
  moverFornecedor,
  mudarStatusPedido,
  pedirApresentacao,
  promoverContatoDescoberto,
  reatribuirFornecedor,
  salvarConfigFornecedores,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  dispararBuscaAprofundada,
  dispararBuscarContatos,
  dispararFunilFornecedores,
} from '@/lib/mercado/worker'
import type { ActionResult } from './empresas'

/**
 * Mutations do funil de cadastro de fornecedores (04l).
 *
 * O client é o do USUÁRIO, nunca o de service role. As RPCs são SECURITY DEFINER mas
 * checam `app_tem_modulo('comercial')` e `app_fornecedor_visivel` por dentro — e é
 * essa checagem que impede um originador de mexer no card de outro. Passar o admin
 * aqui anularia a única autorização que existe.
 */

async function autorizar() {
  const context = await getSessionContext()
  if (!context) {
    return { erro: { ok: false as const, message: 'Sessão expirada.', code: 'auth' }, supabase: null, context: null }
  }
  if (!context.grantedModuleIds.includes('comercial')) {
    return {
      erro: { ok: false as const, message: 'Sem acesso ao módulo Comercial.', code: 'forbidden' },
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

const ROTA = '/comercial/fornecedores'

export async function moverFornecedorAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await moverFornecedor(supabase, input)
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export async function descartarFornecedorAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await descartarFornecedor(supabase, input)
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export async function reatribuirFornecedorAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await reatribuirFornecedor(supabase, input)
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export async function promoverContatoAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const c = (await promoverContatoDescoberto(supabase, input)) as { id?: string } | null
    revalidatePath(ROTA)
    return { ok: true, data: { id: c?.id ?? '' } }
  } catch (e) {
    return falha(e)
  }
}

export async function pedirApresentacaoAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const p = (await pedirApresentacao(supabase, input)) as { id?: string } | null
    revalidatePath(ROTA)
    return { ok: true, data: { id: p?.id ?? '' } }
  } catch (e) {
    return falha(e)
  }
}

export async function statusPedidoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await mudarStatusPedido(supabase, input)
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export async function salvarConfigFornecedoresAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarConfigFornecedores(supabase, input)
    revalidatePath('/comercial/admin')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export interface ResultadoBusca {
  ok: boolean
  motivo?: string
  contatosNovos: number
  custo: number
  parouEm?: string
  orcamento: { gasto: number; teto: number; saldo: number }
}

/**
 * O clique pago (§4.2).
 *
 * ─── A AUTORIZAÇÃO É CHECADA AQUI, NÃO NO WORKER ─────────────────────────────
 *
 * O worker roda com service role e não sabe quem clicou. Esta action confirma que o
 * usuário enxerga o fornecedor — pela mesma RPC que a RLS usa — ANTES de mandar
 * gastar dinheiro. Sem isso, quem soubesse um CNPJ poderia queimar o teto de outro.
 *
 * ─── `forcar` É DO GESTOR ────────────────────────────────────────────────────
 *
 * Estourar o teto do mês é decisão de quem responde pelo orçamento. Um originador
 * que passe `forcar: true` no payload recebe a mesma recusa de saldo que receberia
 * sem ele.
 */
export async function buscarContatosAction(input: {
  cnpj: string
  forcar?: boolean
}): Promise<ActionResult<ResultadoBusca>> {
  const { erro, supabase, context } = await autorizar()
  if (erro || !supabase || !context) return erro as ActionResult<never>

  const { data: visivel, error: erroVis } = await supabase.rpc('app_fornecedor_visivel', {
    p_cnpj: input.cnpj,
  })
  if (erroVis) return falha(erroVis)
  if (visivel !== true) {
    return { ok: false, message: 'Este fornecedor não está na sua carteira.', code: 'forbidden' }
  }

  let forcar = false
  if (input.forcar) {
    const { data: gestor } = await supabase.rpc('app_gestor_comercial')
    forcar = gestor === true
  }

  const r = await dispararBuscarContatos({
    cnpj: input.cnpj,
    solicitadoPor: context.usuario.id,
    forcar,
  })
  if (!r.ok) return { ok: false, message: r.message, code: 'unknown' }

  revalidatePath(ROTA)
  const corpo = (r.corpo ?? {}) as Partial<ResultadoBusca>
  return {
    ok: true,
    data: {
      ok: corpo.ok ?? false,
      ...(corpo.motivo ? { motivo: corpo.motivo } : {}),
      contatosNovos: corpo.contatosNovos ?? 0,
      custo: corpo.custo ?? 0,
      ...(corpo.parouEm ? { parouEm: corpo.parouEm } : {}),
      orcamento: corpo.orcamento ?? { gasto: 0, teto: 0, saldo: 0 },
    },
  }
}

/**
 * A segunda busca (§4.2c aprofundada).
 *
 * Mesma autorização do primeiro clique, e pelas mesmas razões: o worker roda com
 * service role e não sabe quem clicou, e `forcar` é do gestor.
 */
export async function buscaAprofundadaAction(input: {
  cnpj: string
  forcar?: boolean
}): Promise<ActionResult<ResultadoBusca>> {
  const { erro, supabase, context } = await autorizar()
  if (erro || !supabase || !context) return erro as ActionResult<never>

  const { data: visivel, error: erroVis } = await supabase.rpc('app_fornecedor_visivel', {
    p_cnpj: input.cnpj,
  })
  if (erroVis) return falha(erroVis)
  if (visivel !== true) {
    return { ok: false, message: 'Este fornecedor não está na sua carteira.', code: 'forbidden' }
  }

  let forcar = false
  if (input.forcar) {
    const { data: gestor } = await supabase.rpc('app_gestor_comercial')
    forcar = gestor === true
  }

  const r = await dispararBuscaAprofundada({
    cnpj: input.cnpj,
    solicitadoPor: context.usuario.id,
    forcar,
  })
  if (!r.ok) return { ok: false, message: r.message, code: 'unknown' }

  revalidatePath(ROTA)
  const corpo = (r.corpo ?? {}) as Partial<ResultadoBusca>
  return {
    ok: true,
    data: {
      ok: corpo.ok ?? false,
      ...(corpo.motivo ? { motivo: corpo.motivo } : {}),
      contatosNovos: corpo.contatosNovos ?? 0,
      custo: corpo.custo ?? 0,
      orcamento: corpo.orcamento ?? { gasto: 0, teto: 0, saldo: 0 },
    },
  }
}

/** Recalcula a munição sob demanda. Gestor só — é uma varredura, não uma consulta. */
export async function atualizarFunilAction(): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  const { data: gestor } = await supabase.rpc('app_gestor_comercial')
  if (gestor !== true) {
    return { ok: false, message: 'Só um gestor comercial recalcula o funil.', code: 'forbidden' }
  }
  const r = await dispararFunilFornecedores()
  if (!r.ok) return { ok: false, message: r.message, code: 'unknown' }
  revalidatePath(ROTA)
  return { ok: true, data: { ok: true } }
}

/** Registra ligação/WhatsApp/e-mail. É o que o §6 usa para atribuir a fonte ao cadastro. */
export async function registrarToqueAction(input: {
  fornecedor_cnpj: string
  canal: 'ligacao' | 'whatsapp' | 'email'
  contato_descoberto_id?: string | null
  contato?: string | null
}): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const { error } = await supabase.rpc('app_fornecedor_toque', { p: input as never })
    if (error) throw new Error(error.message)
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}
