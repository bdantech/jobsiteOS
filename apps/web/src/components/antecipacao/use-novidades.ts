'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CALENDARIO_SO_FIM_DE_SEMANA,
  CONFIG_NOVIDADES_PADRAO,
  buscarContextoNovidades,
  buscarResumoNovidades,
  marcarVisitaAoFunil,
  resolverJanelaNovidades,
  type IntervaloPersonalizado,
  type JanelaNovidades,
  type OpcaoNovidades,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'
import { antecipacaoKeys } from './queries'

/**
 * A janela de novidades do funil (04t), do lado da tela.
 *
 * Tudo que mostra "o que entrou" — o seletor do Kanban, o contador da aba e o card do
 * Meu Dia — passa por aqui, para os três falarem da mesma janela. O cálculo em si mora
 * no core e é o mesmo do celular.
 */

export const novidadesKeys = {
  contexto: () => [...antecipacaoKeys.all, 'novidades', 'contexto'] as const,
  resumo: (de: string, ate: string | null, vendedorId: string | null) =>
    [...antecipacaoKeys.all, 'novidades', 'resumo', de, ate, vendedorId] as const,
  visita: () => ['funil-visita'] as const,
}

/** De quanto em quanto tempo "agora" anda. A janela de 6 horas não precisa de mais que isso. */
const PASSO_MS = 5 * 60_000

/**
 * "Agora", arredondado para baixo em passos de cinco minutos.
 *
 * Um `new Date()` a cada render mudaria a chave das cinco colunas do Kanban a cada
 * tecla digitada na busca. Em passos, a janela de "últimas 6 horas" anda sozinha sem
 * que a tela recarregue o tempo todo.
 */
export function useAgora(): Date {
  const [marca, setMarca] = React.useState(() => Math.floor(Date.now() / PASSO_MS) * PASSO_MS)
  React.useEffect(() => {
    const id = window.setInterval(() => setMarca(Math.floor(Date.now() / PASSO_MS) * PASSO_MS), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return React.useMemo(() => new Date(marca), [marca])
}

/** Expediente e calendário. Enquanto carrega, vale o padrão — a janela nunca fica sem resposta. */
export function useContextoNovidades() {
  const q = useQuery({
    queryKey: novidadesKeys.contexto(),
    queryFn: () => buscarContextoNovidades(createClient()),
    staleTime: 30 * 60_000,
  })
  return {
    cfg: q.data?.cfg ?? CONFIG_NOVIDADES_PADRAO,
    calendario: q.data?.calendario ?? CALENDARIO_SO_FIM_DE_SEMANA,
    carregado: q.isSuccess,
  }
}

/** A janela da opção escolhida. `null` = filtro desligado (ou personalizado sem início). */
export function useJanelaNovidades(
  opcao: OpcaoNovidades | null,
  personalizado?: IntervaloPersonalizado,
): { janela: JanelaNovidades | null; agora: Date; carregado: boolean } {
  const agora = useAgora()
  const { cfg, calendario, carregado } = useContextoNovidades()
  const de = personalizado?.de?.getTime()
  const ate = personalizado?.ate?.getTime()

  const janela = React.useMemo(
    () =>
      opcao
        ? resolverJanelaNovidades(opcao, agora, calendario, cfg, {
            de: de ? new Date(de) : null,
            ate: ate ? new Date(ate) : null,
          })
        : null,
    [opcao, agora, calendario, cfg, de, ate],
  )
  return { janela, agora, carregado }
}

/**
 * Quantos itens entraram na janela, por tipo e por carteira.
 *
 * Sem Realtime: nenhuma das três tabelas do funil está publicada, e o funil não usa
 * canal nenhum. O número se renova a cada cinco minutos, ao voltar para a aba e sempre
 * que o funil é invalidado (mover um card, atribuir uma nota, "Atualizar").
 */
export function useResumoNovidades(
  janela: JanelaNovidades | null,
  vendedorId?: string | null,
  habilitado = true,
) {
  const de = janela?.de.toISOString() ?? ''
  const ate = janela?.ate?.toISOString() ?? null
  return useQuery({
    queryKey: novidadesKeys.resumo(de, ate, vendedorId ?? null),
    queryFn: () => buscarResumoNovidades(createClient(), janela!, vendedorId),
    enabled: habilitado && Boolean(janela),
    staleTime: 2 * 60_000,
    refetchInterval: PASSO_MS,
    refetchOnWindowFocus: true,
  })
}

/**
 * O marcador de visita (§6): registra a abertura do funil e devolve o marcador
 * ANTERIOR, que é com quem o selo "novo" compara.
 *
 * A chamada se repete a cada MONTAGEM do funil, e não a cada foco: quem decide se
 * aquilo foi uma visita nova é o banco (só avança depois do intervalo configurado), e
 * uma aba que fica aberta o fim de semana inteiro precisa avisar na segunda que a
 * pessoa voltou. Entre uma montagem e outra o marcador não se mexe — é isso que mantém
 * os selos estáveis enquanto a pessoa trabalha.
 */
export function useVisitaAoFunil(habilitado = true) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: novidadesKeys.visita(),
    queryFn: () => marcarVisitaAoFunil(createClient()),
    enabled: habilitado,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })

  const marcarTudo = React.useCallback(async () => {
    const r = await marcarVisitaAoFunil(createClient(), true)
    qc.setQueryData(novidadesKeys.visita(), r)
  }, [qc])

  return { vistoAnterior: q.data?.visto_anterior ?? null, marcarTudo }
}
