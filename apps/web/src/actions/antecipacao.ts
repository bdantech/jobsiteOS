'use server'

import { revalidatePath } from 'next/cache'
import {
  MutationError,
  ativarFaixaRegra,
  canAccessRoute,
  definirPontoFocal,
  descartarMensagem,
  marcarSemInteresse,
  moverEstagio,
  registrarToqueManual,
  salvarAntecipacaoConfig,
  salvarFaixaDisparo,
  salvarFaixaRegra,
  salvarWhatsappConta,
  type FieldErrors,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  dispararAntecipacaoDiario,
  dispararContatosNf,
  dispararLookupCadastral,
  dispararOutbox,
  dispararReclassificacaoFunil,
  dispararSyncNfs,
} from '@/lib/mercado/worker'

/**
 * Mutações do módulo Antecipação. Todas pelos write helpers de @jobsiteos/core
 * (RPCs da migração 0047, com evento + audit_log na mesma transação), sempre com
 * o client do USUÁRIO — o RLS decide o que a escrita toca. Os jobs são
 * enfileirados no worker.
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

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null }
  if (!canAccessRoute('/antecipacao', context.grantedModuleIds)) {
    return { erro: SEM_MODULO as Falha, supabase: null }
  }
  return { erro: null, supabase: await createClient() }
}

function falhaDe(e: unknown): Falha {
  if (e instanceof MutationError) return { ok: false, message: e.message, code: e.code, fieldErrors: e.fieldErrors }
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

// ─── Funil ──────────────────────────────────────────────────────────────────

export async function moverEstagioAction(input: unknown): Promise<ActionResult<Tables<'notas_fiscais'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const nf = await moverEstagio(supabase, input)
    revalidatePath('/antecipacao')
    return { ok: true, data: nf }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function marcarSemInteresseAction(input: unknown): Promise<ActionResult<Tables<'supressao'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const sup = await marcarSemInteresse(supabase, input)
    revalidatePath('/antecipacao')
    revalidatePath('/radar/supressao')
    return { ok: true, data: sup }
  } catch (e) {
    return falhaDe(e)
  }
}

/** Ligação / WhatsApp / e-mail disparados pelo app. Alimenta o cooldown da outbox. */
export async function registrarToqueManualAction(input: unknown): Promise<ActionResult<null>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    await registrarToqueManual(supabase, input)
    return { ok: true, data: null }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Regras de faixa ────────────────────────────────────────────────────────

/**
 * Salvar cria a próxima VERSÃO; ativar troca qual vale. Ativar dispara a
 * reclassificação do funil inteiro — sem isso as notas continuariam carregando a
 * faixa que a regra antiga atribuiu, e o Kanban mostraria um número que nenhuma
 * regra ativa justifica.
 */
export async function salvarFaixaRegraAction(
  input: unknown,
): Promise<ActionResult<{ regra: Tables<'faixa_regras'>; enfileirado: boolean; aviso?: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  let regra: Tables<'faixa_regras'>
  try {
    regra = await salvarFaixaRegra(supabase, input)
  } catch (e) {
    return falhaDe(e)
  }

  let enfileirado = false
  let aviso: string | undefined
  if (regra.ativa) {
    const r = await dispararReclassificacaoFunil()
    enfileirado = r.ok
    aviso = r.ok ? undefined : r.message
  }

  revalidatePath('/antecipacao/faixas')
  revalidatePath('/antecipacao')
  return { ok: true, data: { regra, enfileirado, aviso } }
}

export async function ativarFaixaRegraAction(
  id: string,
): Promise<ActionResult<{ regra: Tables<'faixa_regras'>; enfileirado: boolean; aviso?: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  let regra: Tables<'faixa_regras'>
  try {
    regra = await ativarFaixaRegra(supabase, { id })
  } catch (e) {
    return falhaDe(e)
  }
  const r = await dispararReclassificacaoFunil()
  revalidatePath('/antecipacao/faixas')
  revalidatePath('/antecipacao')
  return { ok: true, data: { regra, enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

// ─── Régua de disparo, contas e outbox ──────────────────────────────────────

export async function salvarFaixaDisparoAction(
  input: unknown,
): Promise<ActionResult<Tables<'faixa_disparos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const cfg = await salvarFaixaDisparo(supabase, input)
    // A régua mudou: regenera a fila-sombra para que a tela de Outbox mostre o
    // que a régua NOVA produziria, não o que a antiga produziu.
    await dispararOutbox()
    revalidatePath('/antecipacao/disparos')
    revalidatePath('/antecipacao/outbox')
    return { ok: true, data: cfg }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function salvarWhatsappContaAction(
  input: unknown,
): Promise<ActionResult<Tables<'whatsapp_contas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const conta = await salvarWhatsappConta(supabase, input)
    revalidatePath('/antecipacao/whatsapp')
    return { ok: true, data: conta }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function descartarMensagemAction(
  input: unknown,
): Promise<ActionResult<Tables<'mensagens_outbox'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const msg = await descartarMensagem(supabase, input)
    revalidatePath('/antecipacao/outbox')
    return { ok: true, data: msg }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Ponto focal (Company 360) ──────────────────────────────────────────────

export async function definirPontoFocalAction(
  input: unknown,
): Promise<ActionResult<Tables<'contatos'>>> {
  // Autoriza pelo módulo `empresas`: o ponto focal é um atributo do CONTATO, e a
  // lista de contatos vive na Company 360. Quem pode editar contato pode marcar
  // qual deles é o ponto focal.
  const context = await getSessionContext()
  if (!context) return SEM_SESSAO
  if (!canAccessRoute('/empresas', context.grantedModuleIds)) {
    return { ok: false, message: 'Você não tem acesso ao módulo Empresas.', code: 'forbidden' }
  }
  try {
    const contato = await definirPontoFocal(await createClient(), input)
    revalidatePath(`/empresas/${contato.empresa_id}`)
    return { ok: true, data: contato }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Settings e jobs ────────────────────────────────────────────────────────

export async function salvarConfigAction(
  input: unknown,
): Promise<ActionResult<Tables<'antecipacao_config'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const cfg = await salvarAntecipacaoConfig(supabase, input)
    revalidatePath('/antecipacao/config')
    return { ok: true, data: cfg }
  } catch (e) {
    return falhaDe(e)
  }
}

async function enfileirar(
  disparo: () => Promise<{ ok: boolean; message?: string }>,
): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await disparo()
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

// Cada uma escrita por extenso, e não como `const x = () => enfileirar(...)`: um
// módulo 'use server' só pode exportar FUNÇÕES ASSÍNCRONAS — uma arrow function
// que devolve promise não passa pelo compilador do Next.

export async function sincronizarNfsAction() {
  return enfileirar(dispararSyncNfs)
}

export async function rodarDiarioAction() {
  return enfileirar(dispararAntecipacaoDiario)
}

export async function reclassificarFunilAction() {
  return enfileirar(dispararReclassificacaoFunil)
}

export async function regenerarOutboxAction() {
  return enfileirar(dispararOutbox)
}

export async function rodarLookupAction() {
  return enfileirar(dispararLookupCadastral)
}

export async function rodarContatosNfAction() {
  return enfileirar(dispararContatosNf)
}
