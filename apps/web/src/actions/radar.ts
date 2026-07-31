'use server'

import { revalidatePath } from 'next/cache'
import {
  MutationError,
  aprovarLote,
  cancelarLote,
  canAccessRoute,
  criarLote,
  removerSupressao,
  salvarRadarConfig,
  suprimir,
  type FieldErrors,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  dispararBackfillFuncionarios,
  dispararContatosEmpresa,
  dispararDominioEmpresa,
  dispararEstimadorMensal,
  dispararFuncionariosEmpresa,
  dispararFuncionariosLote,
  dispararLoteRadar,
  dispararProtestosEmpresa,
  dispararReestimarFaturamento,
  dispararSincronizarOnepay,
} from '@/lib/mercado/worker'

/**
 * Mutações do módulo Radar. Todas pelos write helpers de @jobsiteos/core (RPCs
 * SECURITY INVOKER da migração 0029, com audit_log), sempre com o client do USUÁRIO
 * (o RLS decide o que a escrita toca). A execução de lote é enfileirada no worker.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = { ok: false, message: 'Sua sessão expirou. Entre novamente.', code: 'forbidden' }
const SEM_MODULO: Falha = { ok: false, message: 'Você não tem acesso ao módulo Radar.', code: 'forbidden' }

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null }
  if (!canAccessRoute('/radar', context.grantedModuleIds)) return { erro: SEM_MODULO as Falha, supabase: null }
  return { erro: null, supabase: await createClient() }
}

function falhaDe(e: unknown): Falha {
  if (e instanceof MutationError) return { ok: false, message: e.message, code: e.code, fieldErrors: e.fieldErrors }
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

export async function criarLoteAction(input: unknown): Promise<ActionResult<Tables<'lotes_enriquecimento'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const lote = await criarLote(supabase, input)
    // Notifica os aprovadores (Admin) — best-effort: uma falha aqui não desfaz o lote.
    if (lote.status === 'aguardando_aprovacao') {
      await supabase.from('empresa_eventos').insert({
        empresa_id: null,
        tipo: 'lote.aguardando_aprovacao',
        ator_usuario_id: null,
        payload: {
          titulo: 'Lote aguardando aprovação',
          resumo: `Lote de ${lote.tipo} pronto para aprovação${lote.nome ? `: ${lote.nome}` : ''}.`,
          url: `/radar/lotes/${lote.id}`,
        } as never,
      })
    }
    revalidatePath('/radar/lotes')
    return { ok: true, data: lote }
  } catch (e) {
    return falhaDe(e)
  }
}

/** Aprova o lote e JÁ o enfileira no worker (aprovar → aprovado → worker consome). */
export async function aprovarLoteAction(id: string): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    await aprovarLote(supabase, { id })
  } catch (e) {
    return falhaDe(e)
  }
  const disparo = await dispararLoteRadar(id)
  revalidatePath(`/radar/lotes/${id}`)
  revalidatePath('/radar/lotes')
  // Aprovado com sucesso; se o worker não aceitou, o lote fica 'aprovado' e dá pra re-disparar.
  return {
    ok: true,
    data: { enfileirado: disparo.ok, aviso: disparo.ok ? undefined : disparo.message },
  }
}

export async function executarLoteAction(id: string): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro
  const disparo = await dispararLoteRadar(id)
  revalidatePath(`/radar/lotes/${id}`)
  return { ok: true, data: { enfileirado: disparo.ok, aviso: disparo.ok ? undefined : disparo.message } }
}

/** Dispara o sync dos clientes Onepay no worker (o mesmo do cron diário). */
export async function sincronizarOnepayAction(): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await dispararSincronizarOnepay()
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

/**
 * Dispara protestos (ação PAGA) de uma empresa + SPEs opcionais. A confirmação de custo
 * já aconteceu no cliente (radar_protestos_empresa_previa mostrou a estimativa); este
 * clique é a aprovação. Autoriza pelo módulo Radar, dono do dado e do orçamento.
 */
export async function rodarProtestosEmpresaAction(input: {
  empresaId: string
  incluirSpes: boolean
  anoMin: number | null
}): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await dispararProtestosEmpresa(input)
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

/**
 * Dispara contatos do Apollo (ação PAGA) de uma empresa. Autoriza pelo módulo Radar,
 * dono do dado e do orçamento — a ficha da empresa é só de onde o clique parte.
 *
 * O TTL de contatos vale: se o domínio foi enriquecido dentro da janela, o item volta
 * `pulado` e nada é cobrado. Por isso o botão não precisa de confirmação de custo a
 * cada clique, ao contrário de protestos.
 */
export async function rodarContatosEmpresaAction(input: {
  empresaId: string
  revelarTelefone?: boolean
}): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await dispararContatosEmpresa(input)
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

/**
 * Roda a cascata de domínio de UMA empresa (Radar §3), do botão da ficha.
 *
 * Autoriza pelo módulo Radar, dono do dado e do orçamento — a ficha é só de onde o
 * clique parte, como em protestos e contatos.
 */
export async function resolverDominioEmpresaAction(
  empresaId: string,
): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await dispararDominioEmpresa(empresaId)
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

/**
 * Atualiza o headcount de UMA empresa (04c §4.3).
 *
 * Sem confirmação de custo, ao contrário de protestos: `organizations/enrich` não
 * consome crédito de revelação. Se um dia o plano passar a cobrar, o valor está em
 * `radar_config.funcionarios.custo_unitario` e este botão precisa ganhar um diálogo.
 */
export async function atualizarFuncionariosAction(
  empresaId: string,
): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await dispararFuncionariosEmpresa(empresaId)
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

export async function rodarFuncionariosLoteAction(
  loteId: string,
): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await dispararFuncionariosLote(loteId)
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

/** Backfill retroativo do headcount que já foi pago e nunca lido. Custo zero. */
export async function rodarBackfillFuncionariosAction(): Promise<
  ActionResult<{ enfileirado: boolean; aviso?: string }>
> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await dispararBackfillFuncionarios()
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

/** "Recalibrar agora": recalibra nos declarantes e reestima todo mundo em seguida. */
export async function recalibrarEstimadorAction(): Promise<
  ActionResult<{ enfileirado: boolean; aviso?: string }>
> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await dispararEstimadorMensal()
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

/** Reaplica a versão vigente dos coeficientes, sem recalibrar. */
export async function reestimarFaturamentoAction(): Promise<
  ActionResult<{ enfileirado: boolean; aviso?: string }>
> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await dispararReestimarFaturamento()
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

/** Marca/desmarca uma SPE (afiançada) no monitoramento mensal de protesto. */
export async function monitorarProtestoAction(cnpj: string): Promise<ActionResult<null>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  const { error } = await supabase.rpc('app_monitorar_protesto' as never, { p_cnpj: cnpj } as never)
  if (error) return { ok: false, message: error.message, code: 'unknown' }
  return { ok: true, data: null }
}

export async function desmonitorarProtestoAction(cnpj: string): Promise<ActionResult<null>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  const { error } = await supabase.rpc('app_desmonitorar_protesto' as never, { p_cnpj: cnpj } as never)
  if (error) return { ok: false, message: error.message, code: 'unknown' }
  return { ok: true, data: null }
}

export async function cancelarLoteAction(id: string): Promise<ActionResult<Tables<'lotes_enriquecimento'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const lote = await cancelarLote(supabase, { id })
    revalidatePath(`/radar/lotes/${id}`)
    revalidatePath('/radar/lotes')
    return { ok: true, data: lote }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function suprimirAction(input: unknown): Promise<ActionResult<Tables<'supressao'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const sup = await suprimir(supabase, input)
    revalidatePath('/radar/supressao')
    return { ok: true, data: sup }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function removerSupressaoAction(id: string): Promise<ActionResult<null>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    await removerSupressao(supabase, { id })
    revalidatePath('/radar/supressao')
    return { ok: true, data: null }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function salvarConfigAction(input: unknown): Promise<ActionResult<Tables<'radar_config'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const cfg = await salvarRadarConfig(supabase, input)
    revalidatePath('/radar/config')
    return { ok: true, data: cfg }
  } catch (e) {
    return falhaDe(e)
  }
}
