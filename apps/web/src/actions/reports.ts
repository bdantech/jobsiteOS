'use server'

import { revalidatePath } from 'next/cache'
import {
  STATUS_REPORT_LABELS,
  atualizarReport,
  comentarReport,
  criarReport,
  definirBeta,
  type StatusReport,
} from '@jobsiteos/core'
import { getSessionContext, isAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notificar } from '@/lib/notificacoes.server'
import type { ActionResult } from './empresas'

/**
 * Mutations de "Reportar bugs & melhorias" (04m).
 *
 * O client é o do USUÁRIO, nunca o de service role: as RPCs são SECURITY DEFINER
 * e checam por dentro quem pode o quê (autor vs. admin). Passar o admin aqui
 * anularia a única autorização que existe — e, no caso do comentário interno,
 * transformaria "ignora a flag de quem não é admin" em "aceita de todo mundo".
 *
 * O PUSH, esse sim, precisa do service role, e é por isso que estas duas escritas
 * são server actions e não chamadas diretas do navegador: `notificar()` lê tokens
 * de push, que nenhuma sessão de browser pode enumerar (migração 0005).
 */

const ROTA_ADMIN = '/admin/reports'

function falha(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
  return { ok: false, message, code: 'unknown' }
}

async function sessao() {
  const context = await getSessionContext()
  if (!context) {
    return {
      erro: { ok: false as const, message: 'Sua sessão expirou. Entre novamente.', code: 'auth' },
      supabase: null,
      context: null,
    }
  }
  return { erro: null, supabase: await createClient(), context }
}

// ─── §2 Criar ───────────────────────────────────────────────────────────────

export async function criarReportAction(
  input: unknown,
): Promise<ActionResult<{ id: string; numero: number }>> {
  const { erro, supabase } = await sessao()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const r = await criarReport(supabase, input)
    // O sino dos admins sai do trigger de `empresa_eventos`, dentro da RPC. Nada
    // a notificar aqui: um segundo caminho tocaria o mesmo sino duas vezes.
    revalidatePath(ROTA_ADMIN)
    return { ok: true, data: { id: r.id, numero: r.numero } }
  } catch (e) {
    return falha(e)
  }
}

// ─── §3/§4 Triagem, e o aviso ao autor ──────────────────────────────────────

export async function atualizarReportAction(
  input: unknown,
): Promise<ActionResult<{ numero: number; status: string }>> {
  const { erro, supabase, context } = await sessao()
  if (erro || !supabase || !context) return erro as ActionResult<never>
  try {
    const r = await atualizarReport(supabase, input)

    /*
     * Só notifica se o STATUS mudou. Salvar prioridade não é notícia para quem
     * reportou — é organização interna —, e um sino a cada clique de "salvar" é
     * como o autor aprende a ignorar os avisos que importam.
     *
     * E nunca notifica quem fez a mudança: um admin que reporta e depois resolve
     * o próprio report receberia um push contando o que acabou de fazer.
     */
    if (r.mudou_status && r.autor_id !== context.usuario.id) {
      await notificar([r.autor_id], {
        titulo: `Seu report #${r.numero} mudou para "${STATUS_REPORT_LABELS[r.status as StatusReport] ?? r.status}"`,
        corpo: 'Toque para ver o que mudou.',
        url: `/reports/${r.report_id}`,
      })
    }

    revalidatePath(ROTA_ADMIN)
    return { ok: true, data: { numero: r.numero, status: r.status } }
  } catch (e) {
    return falha(e)
  }
}

export async function comentarReportAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const { erro, supabase, context } = await sessao()
  if (erro || !supabase || !context) return erro as ActionResult<never>
  try {
    const c = await comentarReport(supabase, input)

    /*
     * COMENTÁRIO INTERNO NUNCA NOTIFICA (§4). A policy já esconde a linha do
     * autor; avisá-lo de que "há um comentário novo" que ele não consegue abrir
     * seria pior que não avisar — anunciaria a existência do que foi escondido.
     */
    if (!c.interno) {
      const destinatarios = c.ator_e_admin
        ? // Admin comentou → o autor fica sabendo.
          [c.autor_do_report]
        : // O autor respondeu → quem triaged fica sabendo. Sem isso a resposta
          // dele fica parada num painel que ninguém reabre sem motivo.
          await idsDeAdmins()

      await notificar(
        destinatarios.filter((id) => id !== context.usuario.id),
        {
          titulo: `Novo comentário no report #${c.numero}`,
          corpo: c.ator_e_admin ? 'A administração respondeu.' : `${context.usuario.nome} respondeu.`,
          url: c.ator_e_admin ? `/reports/${c.report_id}` : `${ROTA_ADMIN}?r=${c.report_id}`,
        },
      )
    }

    revalidatePath(ROTA_ADMIN)
    return { ok: true, data: { id: c.comentario_id } }
  } catch (e) {
    return falha(e)
  }
}

/**
 * Quem administra, hoje.
 *
 * Lê `perfil_modulos` com o service role porque a tabela é `app_is_admin()`-only
 * sob RLS — o autor de um report, que é quem dispara este caminho, leria zero
 * linhas e a resposta dele não chegaria a ninguém. A escalação é fechada: uma
 * consulta sem entrada do cliente, que devolve apenas ids.
 */
async function idsDeAdmins(): Promise<string[]> {
  const admin = createAdminClient()
  const { data: perfis } = await admin
    .from('perfil_modulos')
    .select('perfil_id')
    .eq('modulo_id', 'admin')
  const ids = (perfis ?? []).map((p) => p.perfil_id)
  if (ids.length === 0) return []
  const { data: usuarios } = await admin
    .from('usuarios')
    .select('id')
    .in('perfil_id', ids)
    .eq('ativo', true)
  return (usuarios ?? []).map((u) => u.id)
}

// ─── §2 O anexo ─────────────────────────────────────────────────────────────

/**
 * URL assinada e de vida curta para o print.
 *
 * Passa pelo client do USUÁRIO de propósito: a policy `report_anexos_select`
 * (dono do caminho ou admin) é a autorização, e assinar com o service role
 * entregaria o anexo de qualquer report a qualquer sessão que soubesse o caminho.
 */
export async function urlDoAnexoAction(caminho: string): Promise<ActionResult<{ url: string }>> {
  const { erro, supabase } = await sessao()
  if (erro || !supabase) return erro as ActionResult<never>
  const { data, error } = await supabase.storage
    .from('report-anexos')
    // 5 minutos: tempo de abrir a imagem, não de colar o link num chat.
    .createSignedUrl(caminho, 300)
  if (error || !data) {
    return { ok: false, message: 'Não foi possível abrir o anexo.', code: 'storage' }
  }
  return { ok: true, data: { url: data.signedUrl } }
}

// ─── §5 Modo beta ───────────────────────────────────────────────────────────

export async function definirBetaAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase, context } = await sessao()
  if (erro || !supabase || !context) return erro as ActionResult<never>
  // A RPC recusa de novo, e é ela que vale. Esta checagem existe para o erro
  // chegar como uma frase em vez de uma exceção do Postgres.
  if (!isAdmin(context)) {
    return { ok: false, message: 'Somente a administração altera o modo beta.', code: 'forbidden' }
  }
  try {
    await definirBeta(supabase, input)
    revalidatePath('/admin/configuracoes')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}
