'use client'

import { useQuery } from '@tanstack/react-query'
import * as React from 'react'

import { createClient } from '@/lib/supabase/client'

import { buscarNaoVinculadas, contarNaoVinculadas, meuVendedorId } from './queries'

export interface VendedorVisivel {
  id: string
  nome: string
  tipo: string
}

/**
 * De quem é a fila de identificação que está na tela.
 *
 * ── Por que um hook, e não o filtro em cada consulta ────────────────────────
 * A mesma resposta precisa valer em QUATRO lugares na web: a lista da página de
 * não vinculadas, a tarja do inbox, o contador do menu do módulo e o aviso.
 * Quatro resoluções independentes de "quem sou eu aqui" acabariam com o menu
 * dizendo 8, a tarja dizendo 3 e a página abrindo vazia.
 *
 * O espelho disto no celular é apps/mobile/src/features/comunicacao/hooks.ts, e
 * os dois filtram pela MESMA coluna com a MESMA regra — do contrário as duas
 * plataformas discordariam sobre quantas conversas existem, que é exatamente o
 * que o resto deste módulo evita reusando as RPCs da web.
 *
 * Quem pode aparecer no seletor é `comercial_vendedores_visiveis`, que resolve a
 * autorização no banco por `app_pode_ver_vendedor`. Nenhuma decisão de permissão
 * mora aqui.
 */
export function useEscopoFila() {
  const [escolhido, escolher] = React.useState<string | null>(null)

  const meu = useQuery({
    queryKey: ['comunicacao', 'meu-vendedor'],
    queryFn: meuVendedorId,
    staleTime: 5 * 60 * 1000,
  })

  const visiveisQuery = useQuery({
    queryKey: ['comunicacao', 'vendedores-visiveis'],
    queryFn: async (): Promise<VendedorVisivel[]> => {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('comercial_vendedores_visiveis')
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as VendedorVisivel[]
    },
    staleTime: 5 * 60 * 1000,
  })

  const visiveis = visiveisQuery.data ?? []
  const temFilaPropria = Boolean(meu.data)

  return {
    vendedorId: escolhido ?? meu.data ?? null,
    escolhido,
    escolher,
    visiveis,
    temFilaPropria,
    podeTrocar: visiveis.length > 1 || (visiveis.length === 1 && !temFilaPropria),
  }
}

/** A lista, já no escopo resolvido. */
export function useNaoVinculadas(vendedorId: string | null) {
  return useQuery({
    queryKey: ['comunicacao', 'nao-vinculadas', vendedorId],
    queryFn: () => buscarNaoVinculadas(vendedorId),
  })
}

/** O contador das tarjas e do menu, no mesmo escopo da lista. */
export function useContagemNaoVinculadas(vendedorId: string | null) {
  return useQuery({
    queryKey: ['comunicacao', 'nao-vinculadas', 'contagem', vendedorId],
    queryFn: () => contarNaoVinculadas(vendedorId),
  })
}
