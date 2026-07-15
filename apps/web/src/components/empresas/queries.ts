import type { Estagio, Tables, TipoEmpresa } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'
import { resumoDoEvento } from './format'

/**
 * Reads for the Empresas module.
 *
 * These run in the BROWSER against the anon key + the user's session, so every
 * one of them is filtered by RLS (`app_tem_modulo('empresas')`): a user without
 * the module gets zero rows, never an error and never someone else's data.
 * Mutations do NOT go through here — they are server actions (src/actions/empresas.ts),
 * because only the server may run the write helpers.
 */

export interface FiltrosEmpresas {
  termo: string
  estagio: Estagio | null
  tipo: TipoEmpresa | null
  uf: string | null
}

export const FILTROS_VAZIOS: FiltrosEmpresas = {
  termo: '',
  estagio: null,
  tipo: null,
  uf: null,
}

export function temFiltroAtivo(filtros: FiltrosEmpresas): boolean {
  return (
    filtros.termo.trim().length > 0 ||
    filtros.estagio !== null ||
    filtros.tipo !== null ||
    filtros.uf !== null
  )
}

export type EmpresaLista = Pick<
  Tables<'empresas'>,
  'id' | 'cnpj' | 'razao_social' | 'nome_fantasia' | 'tipo' | 'estagio' | 'uf' | 'erp_atual' | 'erp_mrr'
>

const COLUNAS_LISTA =
  'id, cnpj, razao_social, nome_fantasia, tipo, estagio, uf, erp_atual, erp_mrr' as const

/** A list this size is a signal to filter, not to paginate. Keep it honest in the UI. */
export const LIMITE_LISTA = 100

export interface NotaComAutor {
  id: string
  conteudo: string
  criado_em: string
  autor_usuario_id: string
  autor_nome: string | null
}

export interface EventoComAtor {
  id: string
  tipo: string
  criado_em: string
  /** payload.resumo, already narrowed out of the untyped jsonb. */
  resumo: string | null
  ator_nome: string | null
}

export const empresasKeys = {
  all: ['empresas'] as const,
  lista: (filtros: FiltrosEmpresas) => ['empresas', 'lista', filtros] as const,
  detalhe: (id: string) => ['empresas', 'detalhe', id] as const,
  notas: (id: string) => ['empresas', 'notas', id] as const,
  eventos: (id: string) => ['empresas', 'eventos', id] as const,
}

/**
 * PostgREST's `or=` filter is a comma-separated list, and the value is not
 * quoted — a comma or a parenthesis inside the term would be read as syntax and
 * inject an extra condition. `%` would silently become a wildcard. Strip all of
 * them before the term ever reaches the query string.
 */
function sanitizarTermo(termo: string): string {
  return termo.replace(/[,()%*\\]/g, ' ').trim()
}

export async function buscarEmpresas(filtros: FiltrosEmpresas): Promise<EmpresaLista[]> {
  const supabase = createClient()

  let query = supabase
    .from('empresas')
    .select(COLUNAS_LISTA)
    .order('razao_social', { ascending: true, nullsFirst: false })
    .limit(LIMITE_LISTA)

  const termo = sanitizarTermo(filtros.termo)
  if (termo) {
    const condicoes = [`razao_social.ilike.%${termo}%`, `nome_fantasia.ilike.%${termo}%`]
    // CNPJ is stored as 14 bare digits, so "11.222" only matches if we strip the
    // punctuation the user naturally types. Two digits is enough to be a search
    // and not a full-table scan of every row containing a "1".
    const digitos = termo.replace(/\D/g, '')
    if (digitos.length >= 2) condicoes.push(`cnpj.ilike.%${digitos}%`)
    query = query.or(condicoes.join(','))
  }

  if (filtros.estagio) query = query.eq('estagio', filtros.estagio)
  if (filtros.tipo) query = query.eq('tipo', filtros.tipo)
  if (filtros.uf) query = query.eq('uf', filtros.uf)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarEmpresa(id: string): Promise<Tables<'empresas'> | null> {
  const supabase = createClient()

  const { data, error } = await supabase.from('empresas').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/**
 * empresa_notas.autor_usuario_id and empresa_eventos.ator_usuario_id are plain
 * uuid columns with NO foreign key to `usuarios` (migration 0001) — deliberately,
 * so an event survives the user who caused it. PostgREST can only embed across a
 * declared FK, so `select('*, usuarios(nome)')` is not available to us: the join
 * is done here, in one extra round trip.
 *
 * `usuarios` is readable by any active user (migration 0005 grants exactly
 * id, nome, email, perfil_id, ativo, must_change_password, criado_em), so this
 * needs no service-role escalation.
 */
async function nomesDeUsuarios(ids: readonly string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return new Map()

  const supabase = createClient()
  const { data, error } = await supabase.from('usuarios').select('id, nome').in('id', unicos)
  if (error) throw new Error(error.message)

  return new Map((data ?? []).map((u) => [u.id, u.nome]))
}

export async function buscarNotas(empresaId: string): Promise<NotaComAutor[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('empresa_notas')
    .select('id, conteudo, criado_em, autor_usuario_id')
    .eq('empresa_id', empresaId)
    .order('criado_em', { ascending: false })
    .limit(200)

  if (error) throw new Error(error.message)
  const notas = data ?? []

  const nomes = await nomesDeUsuarios(notas.map((n) => n.autor_usuario_id))

  return notas.map((nota) => ({
    ...nota,
    autor_nome: nomes.get(nota.autor_usuario_id) ?? null,
  }))
}

export async function buscarEventos(empresaId: string): Promise<EventoComAtor[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('empresa_eventos')
    .select('id, tipo, payload, criado_em, ator_usuario_id')
    .eq('empresa_id', empresaId)
    .order('criado_em', { ascending: false })
    .limit(100)

  if (error) throw new Error(error.message)
  const eventos = data ?? []

  // ator_usuario_id is null for system/cron events — they have no name to fetch.
  const atores = eventos.map((e) => e.ator_usuario_id).filter((id): id is string => id !== null)
  const nomes = await nomesDeUsuarios(atores)

  return eventos.map((evento) => ({
    id: evento.id,
    tipo: evento.tipo,
    criado_em: evento.criado_em,
    resumo: resumoDoEvento(evento.payload),
    ator_nome: evento.ator_usuario_id ? (nomes.get(evento.ator_usuario_id) ?? null) : null,
  }))
}
