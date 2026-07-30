import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { fetchResumoCertificados, type ResumoCertificadosData } from './api'

export const certificadosKeys = {
  all: ['certificados'] as const,
  resumo: () => [...certificadosKeys.all, 'resumo'] as const,
}

/**
 * O resumo é uma leitura só (a mesma RPC do grid da web). Sem paginação: o que chega
 * é o conjunto inteiro de clientes, e o recorte para o celular acontece no `api.ts`.
 */
export function useCertificadosQuery(): UseQueryResult<ResumoCertificadosData, Error> {
  return useQuery({
    queryKey: certificadosKeys.resumo(),
    queryFn: fetchResumoCertificados,
  })
}
