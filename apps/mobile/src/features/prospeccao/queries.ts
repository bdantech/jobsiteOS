import {
  MutationError,
  descartarSacadoProspeccao,
  moverSacadoProspeccao,
  pedirApresentacaoSacado,
  solicitarAnaliseProspeccao,
  type Tables,
} from '@jobsiteos/core'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { empresasKeys } from '@/features/empresas/queries'
import { supabase } from '@/lib/supabase'
import {
  CONFIG_PROSPECCAO_PADRAO,
  fetchConfigProspeccao,
  fetchNotasDoCard,
  fetchPainelProspeccao,
  fetchQuebraFornecedores,
  fetchSacadosProspeccao,
} from './api'
import type {
  ConfigProspeccao,
  NotasDoCard,
  PainelProspeccao,
  QuebraFornecedor,
  SacadoProspeccao,
} from './types'

/**
 * A raiz do cache do funil de Sacados por NF (04r).
 *
 * Chave PRÓPRIA, e não um ramo de `antecipacaoKeys`: o TanStack casa por prefixo, e
 * pendurar este funil na raiz do outro faria toda mutação de nota invalidar a lista de
 * sacados — e vice-versa. São duas telas que mudam por motivos diferentes, e o único
 * efeito de as unir seria refetch em rede de obra.
 */
export const prospeccaoKeys = {
  all: ['prospeccao'] as const,
  lista: (estagio?: string) => [...prospeccaoKeys.all, 'lista', estagio ?? 'ativos'] as const,
  painel: () => [...prospeccaoKeys.all, 'painel'] as const,
  fornecedores: (id: string) => [...prospeccaoKeys.all, 'fornecedores', id] as const,
  notas: (cnpj: string, fornecedor: string | null) =>
    [...prospeccaoKeys.all, 'notas', cnpj, fornecedor] as const,
  config: () => [...prospeccaoKeys.all, 'config'] as const,
}

// ─── Leituras ───────────────────────────────────────────────────────────────

export function useSacadosProspeccaoQuery(
  estagio?: string,
): UseQueryResult<SacadoProspeccao[], Error> {
  return useQuery({
    queryKey: prospeccaoKeys.lista(estagio),
    queryFn: () => fetchSacadosProspeccao(estagio),
    // O funil é recomposto a cada sync de NF (6× ao dia). Um minuto evita refetch a
    // cada foco de tela sem deixar o dado envelhecer de verdade.
    staleTime: 60 * 1000,
  })
}

export function usePainelProspeccaoQuery(): UseQueryResult<PainelProspeccao, Error> {
  return useQuery({ queryKey: prospeccaoKeys.painel(), queryFn: fetchPainelProspeccao })
}

export function useQuebraFornecedoresQuery(
  sacadoProspeccaoId: string | undefined,
): UseQueryResult<QuebraFornecedor[], Error> {
  return useQuery({
    queryKey: prospeccaoKeys.fornecedores(sacadoProspeccaoId ?? ''),
    queryFn: () => fetchQuebraFornecedores(sacadoProspeccaoId as string),
    enabled: Boolean(sacadoProspeccaoId),
  })
}

export function useNotasDoCardQuery(
  cnpjSacado: string | undefined,
  fornecedorCnpj: string | null,
): UseQueryResult<NotasDoCard, Error> {
  return useQuery({
    queryKey: prospeccaoKeys.notas(cnpjSacado ?? '', fornecedorCnpj),
    queryFn: () => fetchNotasDoCard(cnpjSacado as string, fornecedorCnpj),
    enabled: Boolean(cnpjSacado),
  })
}

export function useConfigProspeccaoQuery(): UseQueryResult<ConfigProspeccao, Error> {
  return useQuery({
    queryKey: prospeccaoKeys.config(),
    queryFn: fetchConfigProspeccao,
    // A régua muda por decisão humana, não por sync. Meia hora é folgado e poupa uma
    // ida ao banco a cada abertura da aba.
    staleTime: 30 * 60 * 1000,
    initialData: CONFIG_PROSPECCAO_PADRAO,
  })
}

// ─── Escritas ───────────────────────────────────────────────────────────────

export function useMoverSacado(): UseMutationResult<
  unknown,
  MutationError | Error,
  { cnpj: string; estagio: string }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v) => moverSacadoProspeccao(supabase, { cnpj_sacado: v.cnpj, estagio: v.estagio }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: prospeccaoKeys.all }),
  })
}

export interface DescartarVars {
  cnpj: string
  estagio: 'descartado' | 'sem_interesse'
  motivo: string
  observacao?: string
}

export function useDescartarSacado(): UseMutationResult<
  unknown,
  MutationError | Error,
  DescartarVars
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v) =>
      descartarSacadoProspeccao(supabase, {
        cnpj_sacado: v.cnpj,
        estagio: v.estagio,
        motivo: v.motivo,
        observacao: v.observacao,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: prospeccaoKeys.all }),
  })
}

/**
 * Abrir a análise na esteira, do celular.
 *
 * Invalida também `empresasKeys`: o RPC grava evento na timeline da construtora, e a
 * Company 360 dela mudou junto.
 */
export function useSolicitarAnaliseSacado(): UseMutationResult<
  Tables<'analises_credito'>,
  MutationError | Error,
  { cnpj: string; limite?: number | null; observacoes?: string }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v) =>
      (await solicitarAnaliseProspeccao(supabase, {
        cnpj_sacado: v.cnpj,
        limite_solicitado: v.limite ?? undefined,
        observacoes: v.observacoes,
      })) as Tables<'analises_credito'>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: prospeccaoKeys.all })
      void qc.invalidateQueries({ queryKey: empresasKeys.all })
    },
  })
}

export function usePedirPonte(): UseMutationResult<
  unknown,
  MutationError | Error,
  { cnpjSacado: string; fornecedorCnpj: string; mensagem: string }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v) =>
      pedirApresentacaoSacado(supabase, {
        cnpj_sacado: v.cnpjSacado,
        fornecedor_cnpj: v.fornecedorCnpj,
        mensagem: v.mensagem,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: prospeccaoKeys.all })
      void qc.invalidateQueries({ queryKey: empresasKeys.all })
    },
  })
}

/** MutationError já traz cópia em pt-BR; qualquer outra coisa não pode vazar. */
export function mensagemDeErro(error: unknown): string {
  if (error instanceof MutationError) return error.message
  return 'Não foi possível concluir a ação. Verifique sua conexão e tente de novo.'
}
