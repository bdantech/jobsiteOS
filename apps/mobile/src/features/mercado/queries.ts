import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { fetchGrupo, fetchResumoPiramide } from './api'
import type { GrupoDetalhe, ResumoPiramide } from './types'

/**
 * The module's cache root.
 *
 * `mercadoKeys.all` (['mercado']) is the prefix EVERY Mercado query hangs off —
 * including the Explorador's, whose own factory (`exploradorKeys`, in
 * components/explorador/queries.ts) is rooted at ['mercado', 'explorador'].
 * TanStack matches by prefix, so invalidating `mercadoKeys.all` after a write
 * lands on all four screens at once instead of leaving one of them showing a
 * company that has since moved into `empresas`.
 *
 * The Explorador and the ficha do universo own their own reads under that root;
 * this file owns the Mapa and the grupo. There is exactly one fetcher and one
 * hook per surface — two would eventually give two answers to "how many SPEs
 * does this group have".
 */
export const mercadoKeys = {
  all: ['mercado'] as const,
  resumo: () => [...mercadoKeys.all, 'resumo'] as const,
  grupos: () => [...mercadoKeys.all, 'grupo'] as const,
  grupo: (id: string) => [...mercadoKeys.grupos(), id] as const,
}

// ─── Mapa ───────────────────────────────────────────────────────────────────

export function useResumoPiramideQuery(): UseQueryResult<ResumoPiramide, Error> {
  return useQuery({
    queryKey: mercadoKeys.resumo(),
    queryFn: fetchResumoPiramide,
    // The pyramid only moves when the worker reclassifies. Re-counting ~2M rows
    // on every focus change would be 24 count queries for a number that did not
    // change.
    staleTime: 5 * 60 * 1000,
  })
}

// ─── Grupo econômico ────────────────────────────────────────────────────────

/**
 * Shared by the grupo screen and the "Grupo" section of the Company 360 — same
 * key, so the two surfaces read the same cache entry and cannot disagree, and
 * the tap-through from the 360 renders instantly.
 */
export function useGrupoQuery(id: string | undefined): UseQueryResult<GrupoDetalhe | null, Error> {
  return useQuery({
    queryKey: mercadoKeys.grupo(id ?? ''),
    queryFn: () => fetchGrupo(id as string),
    enabled: Boolean(id),
  })
}
