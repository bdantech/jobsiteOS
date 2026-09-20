'use server'

import { revalidatePath } from 'next/cache'
import {
  MutationError,
  canAccessRoute,
  descartarSacadoProspeccao,
  moverSacadoProspeccao,
  pedirApresentacaoSacado,
  reatribuirSacadoProspeccao,
  salvarProspeccaoConfig,
  seguirFornecedor,
  solicitarAnaliseProspeccao,
  type FieldErrors,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dispararEnriquecerSacado, dispararFunilSacados } from '@/lib/mercado/worker'

/**
 * Mutações do funil de Sacados por NF (04r).
 *
 * O client é o do USUÁRIO, nunca o de service role. As RPCs são SECURITY DEFINER mas
 * checam `app_tem_modulo('antecipacao')` e `app_sacado_prospeccao_visivel` por dentro —
 * e é essa checagem que impede um originador de mexer no card de outro. Passar o admin
 * aqui anularia a única autorização que existe.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = { ok: false, message: 'Sua sessão expirou. Entre novamente.', code: 'forbidden' }
const SEM_MODULO: Falha = {
  ok: false,
  message: 'Você não tem acesso ao módulo Antecipação.',
  code: 'forbidden',
}

const ROTA = '/antecipacao/sacados-por-nf'

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null, context: null }
  if (!canAccessRoute('/antecipacao', context.grantedModuleIds)) {
    return { erro: SEM_MODULO as Falha, supabase: null, context: null }
  }
  return { erro: null, supabase: await createClient(), context }
}

function falhaDe(e: unknown): Falha {
  if (e instanceof MutationError) {
    return { ok: false, message: e.message, code: e.code, fieldErrors: e.fieldErrors }
  }
  // A mensagem da RPC É a explicação: "este sacado não está na sua carteira", "a lista
  // de motivos vive em Configurações". Trocá-la por um genérico transformaria um erro
  // que se resolve sozinho num chamado de suporte.
  const message = e instanceof Error ? e.message : 'Não foi possível concluir a operação.'
  return { ok: false, message, code: 'unknown' }
}

export async function moverSacadoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as Falha
  try {
    await moverSacadoProspeccao(supabase, input)
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function descartarSacadoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as Falha
  try {
    await descartarSacadoProspeccao(supabase, input)
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function reatribuirSacadoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as Falha
  try {
    await reatribuirSacadoProspeccao(supabase, input)
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function solicitarAnaliseSacadoAction(
  input: unknown,
): Promise<ActionResult<Tables<'analises_credito'>>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as Falha
  try {
    const a = (await solicitarAnaliseProspeccao(supabase, input)) as Tables<'analises_credito'>
    revalidatePath(ROTA)
    // A esteira também muda: quem cuida do Crédito precisa ver o pedido novo sem
    // esperar o cache da rota dele expirar.
    revalidatePath('/credito')
    return { ok: true, data: a }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * Seguir um cedente é o que FAZ o funil existir para quem não titulariza nada — medido
 * em 20/09/2026, 1 dos 130 cedentes que emitem contra sacados não cadastrados tem
 * titular vigente.
 *
 * Por isso o disparo do job vem junto: sem ele a tela ficaria vazia até o próximo sync
 * de NF, e "segui e não apareceu nada" é indistinguível de "não há oportunidade".
 */
export async function seguirFornecedorAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as Falha
  try {
    await seguirFornecedor(supabase, input)
    // Best-effort: o vínculo já está gravado, e o funil se recompõe no próximo sync de
    // qualquer jeito. Uma falha do worker não pode desfazer um clique que deu certo.
    await dispararFunilSacados()
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function pedirApresentacaoSacadoAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as Falha
  try {
    const p = (await pedirApresentacaoSacado(supabase, input)) as { id?: string } | null
    revalidatePath(ROTA)
    return { ok: true, data: { id: p?.id ?? '' } }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function salvarProspeccaoConfigAction(
  input: unknown,
): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as Falha
  try {
    await salvarProspeccaoConfig(supabase, input)
    revalidatePath(ROTA)
    revalidatePath('/antecipacao/config')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falhaDe(e)
  }
}

export interface ResultadoEnriquecerSacado {
  ok: boolean
  motivo?: string
  custo?: number
  teto?: { gasto: number; teto: number; saldo: number; cabe: boolean; alerta: boolean }
}

/**
 * "Enriquecer sacado" — ação PAGA, e a única deste módulo que gasta dinheiro.
 *
 * SÍNCRONA de propósito: a tela mostrou o custo e perguntou se pode. Devolver um id de
 * job e mandar consultar depois transformaria uma decisão de gastar num evento que a
 * pessoa não vê acontecer — a mesma razão do clique do 04l.
 *
 * A autorização é a do MÓDULO, e o teto é conferido no worker contra o dono DO CARD (um
 * gestor olhando o funil de outra pessoa não consome o próprio orçamento). `forcar` só
 * tem efeito para gestor, e quem decide isso é a RPC do worker, não a tela.
 */
export async function enriquecerSacadoAction(input: {
  cnpj: string
  forcar?: boolean
}): Promise<ActionResult<ResultadoEnriquecerSacado>> {
  const { erro, context } = await autorizar()
  if (erro || !context) return erro as Falha
  if (!/^[0-9]{14}$/.test(input.cnpj)) {
    return { ok: false, message: 'CNPJ inválido.', code: 'validation' }
  }

  const r = await dispararEnriquecerSacado({
    cnpj: input.cnpj,
    solicitadoPor: context.user.id,
    forcar: input.forcar ?? false,
  })
  if (!r.ok) return { ok: false, message: r.message, code: r.code }

  revalidatePath(ROTA)
  return { ok: true, data: (r.corpo ?? { ok: true }) as ResultadoEnriquecerSacado }
}
