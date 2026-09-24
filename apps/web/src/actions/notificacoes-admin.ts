'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { PAPEIS, variaveisDoModelo } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/server'
import { getSessionContext, isAdmin } from '@/lib/auth'
import { entregarAgora } from '@/lib/notificacoes.server'

/**
 * O painel de avisos (0262): catálogo, modelo de texto, regras e silêncio.
 *
 * Toda escrita usa o cliente da SESSÃO, não o service role: a RLS das três tabelas
 * é `app_is_admin()`, e o histórico (`notificacao_historico`) grava `auth.uid()` —
 * com o service role ele registraria ninguém como autor. O `requireAdmin` aqui é a
 * segunda tranca; a primeira é o banco.
 */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; message: string }

const PROIBIDO = 'Só admin configura avisos.'
const ROTA = '/admin/notificacoes'

async function sessaoAdmin() {
  const context = await getSessionContext()
  if (!context || !isAdmin(context)) return null
  return { context, supabase: await createClient() }
}

function falha(e: unknown, padrao: string): { ok: false; message: string } {
  return { ok: false, message: e instanceof Error && e.message ? e.message : padrao }
}

// ─── Modelo de texto ────────────────────────────────────────────────────────

const modeloSchema = z.object({
  tipo: z.string().min(1),
  titulo_modelo: z.string().max(300).nullable(),
  corpo_modelo: z.string().max(2000).nullable(),
  url_modelo: z.string().max(500).nullable(),
})

export interface Previa {
  tem_exemplo: boolean
  variaveis: { nome: string; exemplo: string | null }[]
  titulo: string | null
  corpo: string | null
  url: string | null
}

/** O texto renderizado com o último evento real do tipo, e as variáveis que ele tem. */
export async function previaAction(input: unknown): Promise<ActionResult<Previa>> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, message: PROIBIDO }
  const p = modeloSchema.safeParse(input)
  if (!p.success) return { ok: false, message: 'Dados inválidos.' }

  const { data, error } = await s.supabase.rpc('app_notificacao_previa', {
    p_tipo: p.data.tipo,
    p_titulo: p.data.titulo_modelo ?? undefined,
    p_corpo: p.data.corpo_modelo ?? undefined,
    p_url: p.data.url_modelo ?? undefined,
  })
  if (error) return falha(error, 'Não foi possível montar a prévia.')
  return { ok: true, data: data as unknown as Previa }
}

/**
 * Salva o modelo. Uma variável que o evento não tem é recusada AQUI, na hora de
 * salvar — no envio ela viraria texto vazio sem ninguém perceber. Sem exemplo
 * real do tipo (nunca disparou) não há como conferir, e o modelo passa.
 */
export async function salvarModeloAction(input: unknown): Promise<ActionResult> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, message: PROIBIDO }
  const p = modeloSchema.safeParse(input)
  if (!p.success) return { ok: false, message: 'Dados inválidos.' }

  const limpar = (v: string | null) => (v && v.trim() ? v.trim() : null)
  const modelo = {
    titulo_modelo: limpar(p.data.titulo_modelo),
    corpo_modelo: limpar(p.data.corpo_modelo),
    url_modelo: limpar(p.data.url_modelo),
  }

  const previa = await previaAction({ tipo: p.data.tipo, ...modelo })
  if (previa.ok && previa.data.tem_exemplo) {
    const conhecidas = new Set(previa.data.variaveis.map((v) => v.nome))
    const citadas = [
      ...variaveisDoModelo(modelo.titulo_modelo),
      ...variaveisDoModelo(modelo.corpo_modelo),
      ...variaveisDoModelo(modelo.url_modelo),
    ]
    const faltando = [...new Set(citadas.filter((v) => !conhecidas.has(v)))]
    if (faltando.length) {
      return {
        ok: false,
        message: `Este aviso não tem ${faltando.map((v) => `{{${v}}}`).join(', ')}. Use uma das variáveis da lista.`,
      }
    }
  }

  const { error } = await s.supabase
    .from('notificacao_tipos')
    .update({ ...modelo, atualizado_por: s.context.usuario.id, atualizado_em: new Date().toISOString() })
    .eq('tipo', p.data.tipo)
  if (error) return falha(error, 'Não foi possível salvar o modelo.')

  revalidatePath(ROTA)
  revalidatePath(`${ROTA}/${encodeURIComponent(p.data.tipo)}`)
  return { ok: true, data: undefined }
}

/** Pausa ou retoma o tipo inteiro — nenhuma regra dele entrega enquanto pausado. */
export async function alternarTipoAction(input: unknown): Promise<ActionResult> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, message: PROIBIDO }
  const p = z.object({ tipo: z.string().min(1), ativo: z.boolean() }).safeParse(input)
  if (!p.success) return { ok: false, message: 'Dados inválidos.' }

  const { error } = await s.supabase
    .from('notificacao_tipos')
    .update({ ativo: p.data.ativo, atualizado_por: s.context.usuario.id, atualizado_em: new Date().toISOString() })
    .eq('tipo', p.data.tipo)
  if (error) return falha(error, 'Não foi possível mudar o aviso.')

  revalidatePath(ROTA)
  revalidatePath(`${ROTA}/${encodeURIComponent(p.data.tipo)}`)
  return { ok: true, data: undefined }
}

/** "Enviar teste para mim": o texto atual, o último exemplo, só para quem clicou. */
export async function testarAction(input: unknown): Promise<ActionResult> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, message: PROIBIDO }
  const p = z.object({ tipo: z.string().min(1) }).safeParse(input)
  if (!p.success) return { ok: false, message: 'Dados inválidos.' }

  const { data, error } = await s.supabase.rpc('app_notificacao_testar', { p_tipo: p.data.tipo })
  if (error) return falha(error, 'Não foi possível enviar o teste.')
  if (data) await entregarAgora([data])
  return { ok: true, data: undefined }
}

// ─── Regras ─────────────────────────────────────────────────────────────────

const regraSchema = z
  .object({
    id: z.string().uuid().optional(),
    tipo_evento: z.string().min(1),
    alvo: z.discriminatedUnion('tipo', [
      z.object({ tipo: z.literal('perfil'), id: z.string().uuid() }),
      z.object({ tipo: z.literal('usuario'), id: z.string().uuid() }),
      z.object({ tipo: z.literal('papel'), id: z.enum(PAPEIS as [string, ...string[]]) }),
    ]),
    // O sino é sempre gravado; os canais escolhem o que vai ALÉM dele.
    push: z.boolean(),
    email: z.boolean(),
    frequencia: z.enum(['imediato', 'resumo_diario']),
    respeita_silencio: z.boolean(),
    dedup_horas: z.number().int().min(0).max(8760),
    fallback_admin: z.boolean(),
    ativo: z.boolean(),
  })
  .strict()

export async function salvarRegraAction(input: unknown): Promise<ActionResult> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, message: PROIBIDO }
  const p = regraSchema.safeParse(input)
  if (!p.success) return { ok: false, message: 'Dados inválidos.' }
  const r = p.data

  const linha = {
    tipo_evento: r.tipo_evento,
    perfil_id: r.alvo.tipo === 'perfil' ? r.alvo.id : null,
    usuario_id: r.alvo.tipo === 'usuario' ? r.alvo.id : null,
    papel: r.alvo.tipo === 'papel' ? r.alvo.id : null,
    canais: ['sino', ...(r.push ? ['push'] : []), ...(r.email ? ['email'] : [])],
    frequencia: r.frequencia,
    respeita_silencio: r.respeita_silencio,
    dedup_horas: r.dedup_horas,
    fallback_admin: r.fallback_admin,
    ativo: r.ativo,
    atualizado_em: new Date().toISOString(),
  }

  const { error } = r.id
    ? await s.supabase.from('notificacao_regras').update(linha).eq('id', r.id)
    : await s.supabase.from('notificacao_regras').insert(linha)
  if (error) {
    // Os índices únicos da 0078/0262: uma regra por perfil, pessoa ou papel no tipo.
    if (error.code === '23505') return { ok: false, message: 'Já existe uma regra para esse destinatário neste aviso.' }
    return falha(error, 'Não foi possível salvar a regra.')
  }

  revalidatePath(ROTA)
  revalidatePath(`${ROTA}/${encodeURIComponent(r.tipo_evento)}`)
  return { ok: true, data: undefined }
}

export async function excluirRegraAction(input: unknown): Promise<ActionResult> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, message: PROIBIDO }
  const p = z.object({ id: z.string().uuid(), tipo_evento: z.string().min(1) }).safeParse(input)
  if (!p.success) return { ok: false, message: 'Dados inválidos.' }

  const { error } = await s.supabase.from('notificacao_regras').delete().eq('id', p.data.id)
  if (error) return falha(error, 'Não foi possível excluir a regra.')

  revalidatePath(ROTA)
  revalidatePath(`${ROTA}/${encodeURIComponent(p.data.tipo_evento)}`)
  return { ok: true, data: undefined }
}

// ─── Horário de silêncio ────────────────────────────────────────────────────

export async function salvarSilencioAction(input: unknown): Promise<ActionResult> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, message: PROIBIDO }
  const p = z
    .object({ silencio_inicio: z.number().int().min(0).max(23), silencio_fim: z.number().int().min(0).max(23) })
    .safeParse(input)
  if (!p.success) return { ok: false, message: 'Dados inválidos.' }

  const { error } = await s.supabase
    .from('notificacao_config')
    .update({ ...p.data, atualizado_em: new Date().toISOString() })
    .eq('id', true)
  if (error) return falha(error, 'Não foi possível salvar o horário.')

  revalidatePath(ROTA)
  return { ok: true, data: undefined }
}
