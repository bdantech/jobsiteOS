'use server'

import { revalidatePath } from 'next/cache'
import {
  atribuirLeadSdr,
  atribuirNf,
  atribuirVenda,
  definirCarteira,
  definirCarteiraPassiva,
  definirGestaoOperacao,
  gerarTokenIcs,
  moverLeadSdr,
  moverVenda,
  mudarStatusComissao,
  salvarAcessoVendedor,
  salvarComercialConfig,
  salvarComissaoRegra,
  salvarMotivoPerda,
  salvarTerritorio,
  salvarVendedor,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dispararRotearNotas } from '@/lib/mercado/worker'
import type { ActionResult } from './empresas'

/**
 * Mutations do módulo Comercial.
 *
 * O client é o do USUÁRIO, nunca o de service role: as RPCs são SECURITY DEFINER mas
 * checam `app_tem_modulo` e `app_gestor_comercial` por dentro, e é essa checagem que
 * decide quem pode mudar carteira e aprovar comissão. Passar o admin aqui anularia a
 * única autorização que existe.
 */

async function autorizar() {
  const context = await getSessionContext()
  if (!context) {
    return { erro: { ok: false as const, message: 'Sessão expirada.', code: 'auth' }, supabase: null }
  }
  if (!context.grantedModuleIds.includes('comercial')) {
    return { erro: { ok: false as const, message: 'Sem acesso ao módulo Comercial.', code: 'forbidden' }, supabase: null }
  }
  return { erro: null, supabase: await createClient() }
}

function falha(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
  return { ok: false, message, code: 'unknown' }
}

export async function definirGestaoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const e = (await definirGestaoOperacao(supabase, input)) as { id?: string } | null
    if (e?.id) revalidatePath(`/empresas/${e.id}`)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function definirCarteiraAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await definirCarteira(supabase, input)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function definirCarteiraPassivaAction(
  input: unknown,
): Promise<ActionResult<{ adicionadas: number; removidas: number }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const r = (await definirCarteiraPassiva(supabase, input)) as
      | { adicionadas?: number; removidas?: number }
      | null
    revalidatePath('/comercial/admin')
    revalidatePath('/comercial/carteira')
    return { ok: true, data: { adicionadas: r?.adicionadas ?? 0, removidas: r?.removidas ?? 0 } }
  } catch (error) {
    return falha(error)
  }
}

export async function moverLeadAction(input: unknown): Promise<ActionResult<{ id: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const l = (await moverLeadSdr(supabase, input)) as { id?: string } | null
    return { ok: true, data: { id: l?.id ?? null } }
  } catch (error) {
    return falha(error)
  }
}

export async function moverVendaAction(input: unknown): Promise<ActionResult<{ id: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const v = (await moverVenda(supabase, input)) as { id?: string } | null
    return { ok: true, data: { id: v?.id ?? null } }
  } catch (error) {
    return falha(error)
  }
}

/**
 * Pede a análise de crédito a partir do negócio.
 *
 * O RPC reaproveita uma análise ABERTA do mesmo CNPJ quando existe, em vez de recusar como
 * `app_solicitar_analise` faz: do lado do comercial, "já existe uma em andamento" é o caso
 * feliz — o Crédito já está trabalhando — e apresentá-lo como erro faria a pessoa achar que
 * o pedido falhou.
 */
export async function pedirAnaliseDaVendaAction(
  input: { venda_id: string; limite_solicitado?: number },
): Promise<ActionResult<{ id: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const { data, error } = await supabase.rpc('app_solicitar_analise_da_venda', {
      p: input as never,
    })
    if (error) throw new Error(error.message)
    revalidatePath('/comercial')
    return { ok: true, data: { id: (data as { id?: string } | null)?.id ?? null } }
  } catch (error) {
    return falha(error)
  }
}

export async function atribuirLeadSdrAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await atribuirLeadSdr(supabase, input)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function atribuirVendaAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await atribuirVenda(supabase, input)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function atribuirNfAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await atribuirNf(supabase, input)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function mudarStatusComissaoAction(input: unknown): Promise<ActionResult<{ linhas: number }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const n = await mudarStatusComissao(supabase, input)
    return { ok: true, data: { linhas: n } }
  } catch (error) {
    return falha(error)
  }
}

/** Gera (e revoga o anterior) o link .ics do calendário. */
export async function gerarTokenIcsAction(vendedorId?: string): Promise<ActionResult<{ token: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const token = await gerarTokenIcs(supabase, vendedorId)
    return { ok: true, data: { token } }
  } catch (error) {
    return falha(error)
  }
}

// ─── Cadastro ───────────────────────────────────────────────────────────────
//
// Todas revalidam `/comercial/admin`: a tela é lida em servidor no primeiro paint, e
// sem isso o cadastro novo só aparece no refresh seguinte.

export async function salvarVendedorAction(input: unknown): Promise<ActionResult<{ id: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const v = (await salvarVendedor(supabase, input)) as { id?: string } | null
    revalidatePath('/comercial/admin')
    return { ok: true, data: { id: v?.id ?? null } }
  } catch (error) {
    return falha(error)
  }
}

/**
 * Reroteia as NFs vivas agora, em vez de esperar o diário.
 *
 * Chamado depois de mexer na carteira de um originador. Sem isto a pessoa linka a
 * empresa, abre o funil de NFs, não vê nada e conclui que o link não pegou — e no dia
 * seguinte aparecem centenas de notas de uma vez. É o pior dos dois mundos: parece
 * quebrado na hora e parece mágica depois.
 *
 * Devolve `enfileirado: false` em vez de estourar quando o worker não responde: a
 * carteira JÁ foi salva, e transformar "o reroteamento não começou" em erro de
 * salvamento faria a pessoa salvar de novo achando que perdeu o trabalho.
 */
export async function rotearNotasAction(): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro as ActionResult<never>
  const r = await dispararRotearNotas()
  return r.ok
    ? { ok: true, data: { enfileirado: true } }
    : { ok: true, data: { enfileirado: false, aviso: r.message } }
}

export async function salvarTerritorioAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarTerritorio(supabase, input)
    revalidatePath('/comercial/admin')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function salvarRegraAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarComissaoRegra(supabase, input)
    revalidatePath('/comercial/admin')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function salvarAcessoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarAcessoVendedor(supabase, input)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function salvarConfigAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarComercialConfig(supabase, input)
    revalidatePath('/comercial/admin')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function salvarMotivoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarMotivoPerda(supabase, input)
    revalidatePath('/comercial/admin')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}
