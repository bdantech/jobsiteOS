import type { Estagio, Tables } from '@jobsiteos/core'

/** The columns the list actually paints. Selecting `*` for a list is wasted bytes on 4G. */
export type EmpresaListItem = Pick<
  Tables<'empresas'>,
  'id' | 'cnpj' | 'razao_social' | 'nome_fantasia' | 'estagio' | 'tipo' | 'uf' | 'municipio'
>

export type Empresa = Tables<'empresas'>

/**
 * `empresa_notas.autor_usuario_id` has NO foreign key to `usuarios` (migration
 * 0001 declares it as a bare `uuid not null`), so PostgREST cannot embed the
 * author — `select('*, usuarios(nome)')` fails with PGRST200. The name is
 * resolved by a second, batched query and merged in here.
 */
export interface NotaComAutor {
  id: string
  conteudo: string
  criado_em: string
  autor_usuario_id: string
  /** null when the author is no longer a visible `usuarios` row. */
  autor_nome: string | null
}

/** Same story as NotaComAutor: `ator_usuario_id` has no FK either, and is nullable. */
export interface EventoComAtor {
  id: string
  tipo: string
  criado_em: string
  /** `payload.resumo`, written by the 0008 write helpers. */
  resumo: string | null
  /** null for system/cron-generated events. */
  ator_usuario_id: string | null
  ator_nome: string | null
}

export interface Empresa360 {
  empresa: Empresa
  notas: NotaComAutor[]
  eventos: EventoComAtor[]
}

/** `undefined` estagio = "Todas" (no filter). */
export interface EmpresasFiltros {
  termo: string
  estagio?: Estagio
}
