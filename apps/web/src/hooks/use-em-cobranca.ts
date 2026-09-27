'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { buscarCnpjsEmCobranca, sacadoEmCobranca } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * "Este sacado está em cobrança?" para as telas que não são da Cobrança (07 §11).
 *
 * Uma leitura por tela, com staleTime longo: a lista muda quando alguém ENVIA uma
 * notificação ou regulariza um grupo — atos raros e humanos —, e o banco recusa a
 * operação por trigger de qualquer jeito. O que a tela ganha é não oferecer um botão que
 * ia dar erro; um card que demora dez minutos a ganhar o selo não abre operação nenhuma.
 */
export const cnpjsEmCobrancaKey = ['cobranca', 'cnpjs-em-cobranca'] as const

export function useEmCobranca(): {
  bloqueados: ReadonlySet<string>
  emCobranca: (sacadoCnpj: string | null | undefined, matrizCnpj?: string | null) => boolean
} {
  const q = useQuery({
    queryKey: cnpjsEmCobrancaKey,
    queryFn: () => buscarCnpjsEmCobranca(createClient()),
    staleTime: 10 * 60_000,
  })
  const bloqueados = React.useMemo(() => new Set(q.data ?? []), [q.data])
  const emCobranca = React.useCallback(
    (sacadoCnpj: string | null | undefined, matrizCnpj?: string | null) =>
      sacadoEmCobranca(bloqueados, sacadoCnpj, matrizCnpj),
    [bloqueados],
  )
  return { bloqueados, emCobranca }
}
