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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { supabase } from '@/lib/supabase'

/**
 * A janela de novidades do funil (04t), no celular.
 *
 * O caso da segunda-feira de manhã é, na prática, um caso de celular: o originador
 * abre o app antes de chegar à mesa. A conta é a MESMA da web — `resolverJanelaNovidades`
 * mora no core, e o expediente e o calendário vêm das mesmas duas leituras —, para o
 * número do telefone e o do desktop não terem como discordar.
 *
 * As chaves ficam sob `['antecipacao']`: mover um card ou puxar para atualizar
 * invalida a raiz do módulo e leva a contagem junto.
 */
export const novidadesKeys = {
  contexto: () => ['antecipacao', 'novidades', 'contexto'] as const,
  resumo: (de: string, ate: string | null, vendedorId: string | null) =>
    ['antecipacao', 'novidades', 'resumo', de, ate, vendedorId] as const,
  visita: () => ['funil-visita'] as const,
}

const PASSO_MS = 5 * 60_000

/** "Agora" em passos de cinco minutos — ver o hook de mesmo nome na web. */
export function useAgora(): Date {
  const [marca, setMarca] = useState(() => Math.floor(Date.now() / PASSO_MS) * PASSO_MS)
  useEffect(() => {
    const id = setInterval(() => setMarca(Math.floor(Date.now() / PASSO_MS) * PASSO_MS), 60_000)
    return () => clearInterval(id)
  }, [])
  return useMemo(() => new Date(marca), [marca])
}

export function useJanelaNovidades(
  opcao: OpcaoNovidades | null,
  personalizado?: IntervaloPersonalizado,
): { janela: JanelaNovidades | null; agora: Date } {
  const agora = useAgora()
  const contexto = useQuery({
    queryKey: novidadesKeys.contexto(),
    queryFn: () => buscarContextoNovidades(supabase),
    staleTime: 30 * 60_000,
  })
  const cfg = contexto.data?.cfg ?? CONFIG_NOVIDADES_PADRAO
  const calendario = contexto.data?.calendario ?? CALENDARIO_SO_FIM_DE_SEMANA
  const de = personalizado?.de?.getTime()
  const ate = personalizado?.ate?.getTime()

  const janela = useMemo(
    () =>
      opcao
        ? resolverJanelaNovidades(opcao, agora, calendario, cfg, {
            de: de ? new Date(de) : null,
            ate: ate ? new Date(ate) : null,
          })
        : null,
    [opcao, agora, calendario, cfg, de, ate],
  )
  return { janela, agora }
}

export function useResumoNovidades(
  janela: JanelaNovidades | null,
  vendedorId?: string | null,
  habilitado = true,
) {
  const de = janela?.de.toISOString() ?? ''
  const ate = janela?.ate?.toISOString() ?? null
  return useQuery({
    queryKey: novidadesKeys.resumo(de, ate, vendedorId ?? null),
    queryFn: () => buscarResumoNovidades(supabase, janela!, vendedorId),
    enabled: habilitado && Boolean(janela),
    staleTime: 2 * 60_000,
    refetchInterval: PASSO_MS,
  })
}

/** O marcador de visita (§6): o selo "Novo" compara com a visita ANTERIOR. */
export function useVisitaAoFunil() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: novidadesKeys.visita(),
    queryFn: () => marcarVisitaAoFunil(supabase),
    // A cada MONTAGEM da tela, não a cada foco: quem decide se foi uma visita nova é
    // o banco, e entre uma montagem e outra o marcador fica parado.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })

  const marcarTudo = useCallback(async () => {
    const r = await marcarVisitaAoFunil(supabase, true)
    qc.setQueryData(novidadesKeys.visita(), r)
  }, [qc])

  return { vistoAnterior: q.data?.visto_anterior ?? null, marcarTudo }
}
