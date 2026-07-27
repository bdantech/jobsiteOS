import {
  MutationError,
  definirPontoFocal,
  marcarSemInteresse,
  moverEstagio,
  registrarToqueManual,
  type CanalToque,
  type EstagioFunil,
  type Tables,
} from '@jobsiteos/core'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { empresasKeys } from '@/features/empresas/queries'
import { supabase } from '@/lib/supabase'
import {
  PAGINA_FUNIL,
  fetchDetalheFornecedor,
  fetchFunil,
  fetchMinimoOperavel,
  fetchSacados,
  fetchSacadosAProspectar,
} from './api'
import type { DetalheFornecedor, FiltrosFunil, PaginaFunil, SacadoFunil, SacadoProspectar } from './types'

/**
 * A raiz do cache do módulo.
 *
 * `antecipacaoKeys.all` (['antecipacao']) é o prefixo de TODA query do módulo, e o
 * TanStack casa por prefixo — invalidar a raiz depois de uma escrita acerta a lista
 * do funil, o detalhe do fornecedor e a visão por sacado de uma vez. Mover uma nota
 * de estágio muda os três; invalidar só a lista deixaria o detalhe mostrando o
 * estágio antigo.
 */
export const antecipacaoKeys = {
  all: ['antecipacao'] as const,
  funil: (filtros: FiltrosFunil) => [...antecipacaoKeys.all, 'funil', filtros] as const,
  fornecedor: (cnpj: string) => [...antecipacaoKeys.all, 'fornecedor', cnpj] as const,
  sacados: () => [...antecipacaoKeys.all, 'sacados'] as const,
  prospectar: () => [...antecipacaoKeys.all, 'prospectar'] as const,
  minimo: () => [...antecipacaoKeys.all, 'minimo-operavel'] as const,
  xml: (accessKey: string) => [...antecipacaoKeys.all, 'xml', accessKey] as const,
}

// ─── Leituras ───────────────────────────────────────────────────────────────

/**
 * O funil já ACHATADO: a tela recebe uma lista, um mapa e um total, não páginas.
 *
 * O `select` faz o merge dos mapas de fornecedor de todas as páginas. Sem isso o
 * card da página 2 perderia o "+3 notas" que a página 1 já tinha resolvido — e a
 * tela teria que refazer o merge a cada render.
 */
export interface FunilAchatado {
  notas: PaginaFunil['notas']
  fornecedores: PaginaFunil['fornecedores']
  total: number
}

export function useFunilQuery(filtros: FiltrosFunil): UseInfiniteQueryResult<FunilAchatado, Error> {
  return useInfiniteQuery({
    queryKey: antecipacaoKeys.funil(filtros),
    queryFn: ({ pageParam }) => fetchFunil(filtros, pageParam),
    initialPageParam: 0,
    getNextPageParam: (ultima, todas) =>
      todas.reduce((s, p) => s + p.notas.length, 0) < ultima.total ? todas.length : undefined,
    select: (data) => {
      const fornecedores = new Map(data.pages.flatMap((p) => [...p.fornecedores]))
      return {
        notas: data.pages.flatMap((p) => p.notas),
        fornecedores,
        total: data.pages[0]?.total ?? 0,
      }
    },
    // O funil muda a cada sync (6× ao dia) e a cada reclassificação. Um minuto
    // evita refetch a cada foco de tela sem deixar o dado envelhecer de verdade.
    staleTime: 60 * 1000,
  })
}

export function useDetalheFornecedorQuery(
  cnpj: string | undefined,
): UseQueryResult<DetalheFornecedor, Error> {
  return useQuery({
    queryKey: antecipacaoKeys.fornecedor(cnpj ?? ''),
    queryFn: () => fetchDetalheFornecedor(cnpj as string),
    enabled: Boolean(cnpj),
  })
}

export function useSacadosQuery(): UseQueryResult<SacadoFunil[], Error> {
  return useQuery({ queryKey: antecipacaoKeys.sacados(), queryFn: fetchSacados })
}

export function useSacadosProspectarQuery(): UseQueryResult<SacadoProspectar[], Error> {
  return useQuery({ queryKey: antecipacaoKeys.prospectar(), queryFn: fetchSacadosAProspectar })
}

export function useMinimoOperavelQuery(): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: antecipacaoKeys.minimo(),
    queryFn: fetchMinimoOperavel,
    staleTime: 30 * 60 * 1000,
  })
}

// ─── Escritas ───────────────────────────────────────────────────────────────
// Todas pelos write helpers do core, que chamam os RPCs (migration 0047) com o
// client do USUÁRIO. O celular não tem service role, e não precisa: os RPCs
// gravam entidade + evento + audit numa transação e a RLS decide o que pode.

export interface MoverEstagioVars {
  accessKey: string
  estagio: EstagioFunil
  perdaMotivo?: string
}

export function useMoverEstagio(): UseMutationResult<
  Tables<'notas_fiscais'>,
  MutationError | Error,
  MoverEstagioVars
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v) =>
      moverEstagio(supabase, {
        access_key: v.accessKey,
        estagio_funil: v.estagio,
        perda_motivo: v.perdaMotivo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
      // O RPC grava evento na timeline do fornecedor: a Company 360 mudou também.
      void qc.invalidateQueries({ queryKey: empresasKeys.all })
    },
  })
}

export interface SemInteresseVars {
  cnpj: string
  motivo: string
  eterna: boolean
  dias?: number
}

export function useMarcarSemInteresse(): UseMutationResult<
  Tables<'supressao'>,
  MutationError | Error,
  SemInteresseVars
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v) =>
      marcarSemInteresse(supabase, {
        fornecedor_cnpj: v.cnpj,
        motivo: v.motivo,
        eterna: v.eterna,
        dias: v.dias ?? 90,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
      void qc.invalidateQueries({ queryKey: empresasKeys.all })
    },
  })
}

export interface ToqueVars {
  cnpj: string
  canal: CanalToque
  contato?: string | null
  accessKey?: string | null
}

/**
 * O registro do toque manual. É o que faz o cooldown da outbox enxergar o vendedor:
 * sem isso a régua automática manda mensagem para quem acabou de receber uma
 * ligação.
 *
 * Best-effort do ponto de vista da UX: a discagem/abertura do WhatsApp NÃO espera
 * por isto. Falhar o registro não pode impedir a ligação.
 */
export function useRegistrarToque(): UseMutationResult<void, MutationError | Error, ToqueVars> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v) =>
      registrarToqueManual(supabase, {
        fornecedor_cnpj: v.cnpj,
        canal: v.canal,
        contato: v.contato ?? null,
        access_key: v.accessKey ?? null,
      }),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: antecipacaoKeys.fornecedor(v.cnpj) })
      void qc.invalidateQueries({ queryKey: empresasKeys.all })
    },
  })
}

export function useDefinirPontoFocal(): UseMutationResult<
  Tables<'contatos'>,
  MutationError | Error,
  { id: string; pontoFocal: boolean }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v) => definirPontoFocal(supabase, { id: v.id, ponto_focal: v.pontoFocal }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
      void qc.invalidateQueries({ queryKey: empresasKeys.all })
    },
  })
}

/** MutationError já traz cópia em pt-BR; qualquer outra coisa não pode vazar. */
export function mensagemDeErro(error: unknown): string {
  if (error instanceof MutationError) return error.message
  return 'Não foi possível concluir a ação. Verifique sua conexão e tente de novo.'
}

export { PAGINA_FUNIL }
