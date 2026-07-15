import { normalizeCnpj, type Json } from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'
import type {
  Empresa360,
  EmpresaListItem,
  EmpresasFiltros,
  EventoComAtor,
  NotaComAutor,
} from './types'

export const PAGE_SIZE = 25

/** Cap the 360 lists: a long-lived company can accumulate hundreds of rows. */
const DETAIL_LIMIT = 50

const LIST_COLUMNS = 'id, cnpj, razao_social, nome_fantasia, estagio, tipo, uf, municipio'

/**
 * PostgREST parses `or=(col.op.value,col.op.value)`. A comma or parenthesis
 * inside `value` is re-read as a clause separator / grouping, which lets a search
 * term restructure the filter; `%`, `_` and `*` are ILIKE wildcards (PostgREST
 * maps `*` → `%`). The `or` grammar gives us no way to escape any of them, so
 * strip them instead of handing PostgREST a filter the user can rewrite.
 *
 * Dots and slashes are deliberately kept: PostgREST splits each clause on its
 * first two dots only, so a dot in the value is safe — and "S.A." / "0001/81"
 * are exactly what people type into a company search box.
 */
function sanitizeTermo(termo: string): string {
  return termo
    .replace(/[(),"\\%_*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function fetchEmpresasPage(
  filtros: EmpresasFiltros,
  page: number,
): Promise<EmpresaListItem[]> {
  const from = page * PAGE_SIZE

  let query = supabase
    .from('empresas')
    .select(LIST_COLUMNS)
    // razao_social is nullable; keep the unnamed rows at the bottom rather than
    // at the top of page 0. `id` is the tiebreak that makes range() pagination
    // deterministic — without it two rows with the same name can swap pages.
    .order('razao_social', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .range(from, from + PAGE_SIZE - 1)

  if (filtros.estagio) {
    query = query.eq('estagio', filtros.estagio)
  }

  const termo = sanitizeTermo(filtros.termo)
  if (termo) {
    const clauses = [`razao_social.ilike.%${termo}%`, `nome_fantasia.ilike.%${termo}%`]

    // "11.222.333/0001-81" and "11222333" both have to find the row whose cnpj
    // column stores bare digits, so match the digits of the term against it.
    const digits = normalizeCnpj(termo)
    if (digits.length >= 2) clauses.push(`cnpj.ilike.%${digits}%`)

    query = query.or(clauses.join(','))
  }

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

/** `payload` is `Json`: narrow before reading `resumo` rather than casting through it. */
function extractResumo(payload: Json): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const resumo = payload.resumo
  return typeof resumo === 'string' && resumo.length > 0 ? resumo : null
}

/**
 * Names for note authors and event actors.
 *
 * `empresa_notas.autor_usuario_id` / `empresa_eventos.ator_usuario_id` are bare
 * uuid columns with no FK to `usuarios`, so PostgREST refuses to embed them
 * (PGRST200 — "could not find a relationship"). One batched select by id is the
 * only way, and RLS does allow it: an active user may read colleagues' id/nome.
 */
async function fetchNomes(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.from('usuarios').select('id, nome').in('id', ids)
  if (error) throw error

  return new Map((data ?? []).map((usuario) => [usuario.id, usuario.nome]))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function fetchEmpresa360(id: string): Promise<Empresa360 | null> {
  // This id arrives from a deep link (`/empresas/<id>` in a notification url), so
  // it is not guaranteed to be a uuid. Postgres would raise 22P02 on `eq('id', …)`
  // and the screen would show "algo deu errado" — but a garbage id is simply not
  // a company. Answer that directly instead of turning it into an error state.
  if (!UUID_RE.test(id)) return null

  const [empresaResult, notasResult, eventosResult] = await Promise.all([
    supabase.from('empresas').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('empresa_notas')
      .select('id, conteudo, criado_em, autor_usuario_id')
      .eq('empresa_id', id)
      .order('criado_em', { ascending: false })
      .limit(DETAIL_LIMIT),
    supabase
      .from('empresa_eventos')
      .select('id, tipo, criado_em, payload, ator_usuario_id')
      .eq('empresa_id', id)
      .order('criado_em', { ascending: false })
      .limit(DETAIL_LIMIT),
  ])

  if (empresaResult.error) throw empresaResult.error
  // Under RLS "denied" and "no such row" are the same zero-row answer. Both mean
  // "this screen has nothing to show", which is the not-found state, not an error.
  if (!empresaResult.data) return null
  if (notasResult.error) throw notasResult.error
  if (eventosResult.error) throw eventosResult.error

  const notasRows = notasResult.data ?? []
  const eventosRows = eventosResult.data ?? []

  const ids = new Set<string>()
  for (const nota of notasRows) ids.add(nota.autor_usuario_id)
  for (const evento of eventosRows) {
    if (evento.ator_usuario_id) ids.add(evento.ator_usuario_id)
  }
  const nomes = await fetchNomes([...ids])

  const notas: NotaComAutor[] = notasRows.map((nota) => ({
    id: nota.id,
    conteudo: nota.conteudo,
    criado_em: nota.criado_em,
    autor_usuario_id: nota.autor_usuario_id,
    autor_nome: nomes.get(nota.autor_usuario_id) ?? null,
  }))

  const eventos: EventoComAtor[] = eventosRows.map((evento) => ({
    id: evento.id,
    tipo: evento.tipo,
    criado_em: evento.criado_em,
    resumo: extractResumo(evento.payload),
    ator_usuario_id: evento.ator_usuario_id,
    ator_nome: evento.ator_usuario_id ? (nomes.get(evento.ator_usuario_id) ?? null) : null,
  }))

  return { empresa: empresaResult.data, notas, eventos }
}
