import { MutationError, descrever, parseArvore, promoverEmpresa, type Tables } from '@jobsiteos/core'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { empresasKeys } from '@/features/empresas'
import { supabase } from '@/lib/supabase'
import { mercadoKeys } from '../../queries'
import {
  PAGE_SIZE,
  fetchExploradorPage,
  fetchSegmentos,
  fetchUniversoDetalhe,
  type ExploradorPage,
} from './api'
import type {
  ExploradorFiltros,
  ExploradorListItem,
  FiltroArvore,
  Segmento,
  UniversoDetalhe,
} from './types'

/**
 * The Explorador's slice of the module's cache. It is deliberately rooted UNDER
 * `mercadoKeys.all` (['mercado']) rather than beside it: TanStack invalidates by
 * key prefix, so a single `invalidateQueries({ queryKey: mercadoKeys.all })`
 * reaches the Explorador, the ficha, the Mapa and the grupo at once. A sibling
 * root would have to be remembered at every call site — and forgotten at one.
 */
export const exploradorKeys = {
  all: ['mercado', 'explorador'] as const,
  lists: () => [...exploradorKeys.all, 'list'] as const,
  /** The whole filter set — including the composite tree — is the cache identity.
   *  TanStack hashes keys with sorted object keys, so a tree is a stable key. */
  list: (filtros: ExploradorFiltros) => [...exploradorKeys.lists(), filtros] as const,
  universo: (cnpj: string) => [...exploradorKeys.all, 'universo', cnpj] as const,
  segmentos: () => [...exploradorKeys.all, 'segmentos'] as const,
}

/** A 14-digit CNPJ typed into the box is 14 keystrokes — and would be 14 queries. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timeout)
  }, [value, delay])

  return debounced
}

export interface ExploradorResultado {
  rows: ExploradorListItem[]
  /** From page 0. `null` while the first page is still in flight. */
  total: number | null
}

export function useExploradorQuery(
  filtros: ExploradorFiltros,
): UseInfiniteQueryResult<ExploradorResultado, Error> {
  return useInfiniteQuery({
    queryKey: exploradorKeys.list(filtros),
    queryFn: ({ pageParam }) => fetchExploradorPage(filtros, pageParam),
    initialPageParam: 0,
    // A short page means the server ran out of rows: stop asking.
    getNextPageParam: (lastPage: ExploradorPage, allPages) =>
      lastPage.rows.length === PAGE_SIZE ? allPages.length : undefined,
    select: (data) => ({
      rows: data.pages.flatMap((page) => page.rows),
      // noUncheckedIndexedAccess: pages[0] is `ExploradorPage | undefined`.
      total: data.pages[0]?.total ?? null,
    }),
  })
}

export function useSegmentosQuery(enabled: boolean): UseQueryResult<Segmento[], Error> {
  return useQuery({
    queryKey: exploradorKeys.segmentos(),
    queryFn: fetchSegmentos,
    // The list is only fetched when the sheet opens: most sessions never open it.
    enabled,
    staleTime: 60_000,
  })
}

export function useUniversoQuery(
  cnpj: string | undefined,
): UseQueryResult<UniversoDetalhe | null, Error> {
  return useQuery({
    queryKey: exploradorKeys.universo(cnpj ?? ''),
    queryFn: () => fetchUniversoDetalhe(cnpj as string),
    enabled: Boolean(cnpj),
  })
}

/**
 * Promotion goes through the core write helper, never a raw `.insert()`: the
 * helper calls a SECURITY INVOKER Postgres function that inserts into `empresas`,
 * backfills `mercado_universo.empresa_id` and appends the `empresa.promovida`
 * event in ONE transaction. It is idempotent.
 *
 * It takes the USER-SCOPED client — a service-role one would disable every RLS
 * check inside the function. Mobile only ever has the user-scoped one.
 */
export function usePromoverEmpresa(
  cnpj: string,
): UseMutationResult<Tables<'empresas'>, MutationError | Error, void> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => promoverEmpresa(supabase, { cnpj }),
    onSuccess: () => {
      // Promotion writes ACROSS modules, so the invalidation has to as well.
      //
      // `mercadoKeys.all` is the prefix root of the whole module, so this one call
      // covers every cached Explorador page holding the row (its `empresa_id` —
      // and therefore its route and its "na base" badge — just changed), this
      // sheet (which must now offer "ver na base" instead of "promover"), the
      // grupo screen (same badge, for a member of the same group) and the Mapa.
      //
      // `empresasKeys.all` is the one a prefix cannot reach: the company did not
      // just change in Mercado, it came into EXISTENCE in `empresas`. Without this
      // the user promotes a company, switches to the Empresas tab, and does not
      // find it there.
      void queryClient.invalidateQueries({ queryKey: mercadoKeys.all })
      void queryClient.invalidateQueries({ queryKey: empresasKeys.all })
    },
  })
}

/** MutationError carries pt-BR copy already; anything else must not leak to the UI. */
export function promoverErrorMessage(error: unknown): string {
  if (error instanceof MutationError) {
    return error.code === 'not_found'
      ? 'Esta empresa não está mais no universo. Atualize a lista e tente de novo.'
      : error.message
  }
  return 'Não foi possível promover a empresa. Verifique sua conexão e tente novamente.'
}

// ─── Segmentos → árvore ─────────────────────────────────────────────────────

/**
 * `segmentos.definicao` is `jsonb`: the database does not (and cannot) know the
 * variable catalog, so a segment saved against an older catalog can name a
 * variable this build has dropped. `parseArvore` is the gate — a tree that fails
 * it must never reach a compiler, so an unusable segment is surfaced as disabled
 * rather than crashing the sheet.
 */
export function segmentoArvore(segmento: Segmento): FiltroArvore | null {
  try {
    return parseArvore(segmento.definicao)
  } catch {
    return null
  }
}

/** The tree in pt-BR prose, for the segment row and the active-filter pill. */
export function descreverArvore(arvore: FiltroArvore): string {
  return descrever(arvore)
}
