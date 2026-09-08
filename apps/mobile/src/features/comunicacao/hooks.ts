import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { useVendedoresVisiveis, type VendedorVisivel } from '@/features/comercial'

import { buscarNaoVinculadas, comunicacaoKeys, meuVendedorId } from './api'

/**
 * Quem é o "meu" da fila de identificação.
 *
 * Fica num hook próprio, e não solto em cada tela, porque a MESMA resposta tem
 * que valer em dois lugares: o contador da tarja no inbox e a lista da tela de
 * identificação. Duas resoluções independentes seriam a receita para a tarja
 * dizer "8 aguardando" e a tela abrir com 3.
 */
export function useMeuVendedor() {
  return useQuery({
    queryKey: comunicacaoKeys.meuVendedor(),
    queryFn: meuVendedorId,
    // Cadastro de vendedor não muda durante uma sessão.
    staleTime: 5 * 60 * 1000,
  })
}

export interface FilaNaoVinculadasEscopo {
  /** O vendedor efetivamente em tela: o escolhido, ou o próprio usuário. */
  vendedorId: string | null
  /** O escolhido no seletor. `null` = "eu". */
  escolhido: string | null
  escolher: (id: string | null) => void
  /** Pessoas que este usuário pode ver. Vazio para quem só vê a si mesmo. */
  visiveis: readonly VendedorVisivel[]
  /** O usuário tem cadastro de vendedor? Gestor puro não tem. */
  temFilaPropria: boolean
  /** Vale mostrar o seletor? Só para quem enxerga mais de uma pessoa. */
  podeTrocar: boolean
}

/**
 * O escopo da fila: de quem ela é, e se dá para trocar.
 *
 * Mesmo desenho do painel do Comercial, e de propósito — é a mesma pergunta
 * ("de quem é o que estou vendo?") e a mesma autorização: quem pode aparecer no
 * seletor é `comercial_vendedores_visiveis`, que resolve tudo no banco via
 * `app_pode_ver_vendedor`. Nenhuma decisão de permissão mora aqui.
 */
export function useEscopoFila(): FilaNaoVinculadasEscopo {
  const [escolhido, escolher] = useState<string | null>(null)
  const meu = useMeuVendedor()
  const vendedores = useVendedoresVisiveis()

  const visiveis = vendedores.data ?? []
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

/** A fila em si, já no escopo resolvido. */
export function useNaoVinculadas(vendedorId: string | null) {
  return useQuery({
    queryKey: comunicacaoKeys.naoVinculadas(vendedorId),
    queryFn: () => buscarNaoVinculadas(vendedorId),
  })
}
