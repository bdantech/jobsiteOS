'use client'

import { useQuery } from '@tanstack/react-query'
import { ModuloTabs } from '@/components/shell/modulo-tabs'
import { contarNaoVinculadas } from './queries'
import { useEscopoFila } from './use-escopo-fila'

/**
 * Navegação interna da Comunicação. As abas estão no catálogo único
 * (components/shell/abas-dos-modulos.ts); aqui fica só o que é desta barra: o contador
 * da fila de identificação.
 */
export function ComunicacaoNav() {
  /*
   * O CONTADOR VIVE COLADO NO DESTINO.
   *
   * Ele estava na barra do topo, ao lado do sino, e competia com as notificações
   * sem ser uma delas — dois números diferentes lado a lado é como se ensina a
   * não olhar nenhum. Aqui o número e o clique são a mesma coisa: quem vê "3"
   * sabe exatamente onde estão os três.
   */
  // Mesmo escopo da lista de identificação: o contador não pode falar de
  // uma fila diferente da que a página abre.
  const escopo = useEscopoFila()

  const naoVinculadas = useQuery({
    queryKey: ['comunicacao', 'nao-vinculadas', 'contagem', escopo.vendedorId],
    queryFn: () => contarNaoVinculadas(escopo.vendedorId),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  })

  return (
    <ModuloTabs
      moduloId="comunicacao"
      rotulo="Seções da Comunicação"
      contadores={{ nao_vinculadas: naoVinculadas.data ?? 0 }}
    />
  )
}
