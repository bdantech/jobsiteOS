import { MutationError, criarNota } from '@jobsiteos/core'
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

import { supabase } from '@/lib/supabase'
import { PAGE_SIZE, fetchEmpresa360, fetchEmpresasPage } from './api'
import type { Empresa360, EmpresaListItem, EmpresasFiltros } from './types'

export const empresasKeys = {
  all: ['empresas'] as const,
  lists: () => [...empresasKeys.all, 'list'] as const,
  list: (filtros: EmpresasFiltros) => [...empresasKeys.lists(), filtros] as const,
  detail: (id: string) => [...empresasKeys.all, 'detail', id] as const,
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

export function useEmpresasQuery(
  filtros: EmpresasFiltros,
): UseInfiniteQueryResult<EmpresaListItem[], Error> {
  return useInfiniteQuery({
    queryKey: empresasKeys.list(filtros),
    queryFn: ({ pageParam }) => fetchEmpresasPage(filtros, pageParam),
    initialPageParam: 0,
    // A short page means the server ran out of rows: stop asking.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length : undefined,
    select: (data) => data.pages.flat(),
  })
}

export function useEmpresa360Query(id: string | undefined): UseQueryResult<Empresa360 | null, Error> {
  return useQuery({
    queryKey: empresasKeys.detail(id ?? ''),
    queryFn: () => fetchEmpresa360(id as string),
    enabled: Boolean(id),
  })
}

/**
 * Notes go through the core write helper, never a raw `.insert()`: the helper
 * calls a SECURITY INVOKER Postgres function that writes the note, the
 * `empresa_eventos` row and the `audit_log` row in ONE transaction.
 *
 * It takes the USER-SCOPED client — handing it a service-role one would disable
 * every RLS check inside the function. Mobile only ever has the user-scoped one.
 */
export function useCriarNota(
  empresaId: string,
): UseMutationResult<unknown, MutationError | Error, string> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conteudo: string) =>
      criarNota(supabase, { empresa_id: empresaId, conteudo }),
    onSuccess: () => {
      // The same write also appended a `nota.criada` event, so the timeline is
      // stale too — both live under this one detail key.
      void queryClient.invalidateQueries({ queryKey: empresasKeys.detail(empresaId) })
    },
  })
}

/** MutationError carries pt-BR copy already; anything else must not leak to the UI. */
export function notaErrorMessage(error: unknown): string {
  if (error instanceof MutationError) {
    return error.fieldErrors?.conteudo?.[0] ?? error.message
  }
  return 'Não foi possível salvar a nota. Verifique sua conexão e tente novamente.'
}
