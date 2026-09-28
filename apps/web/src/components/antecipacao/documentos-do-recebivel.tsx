'use client'

import { useQuery } from '@tanstack/react-query'
import { Layers } from 'lucide-react'
import {
  SITUACAO_TITULO_LABELS,
  STATUS_PRE_AUTORIZACAO_LABELS,
  type TipoOportunidade,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { antecipacaoKeys, buscarDocumentosDoRecebivel } from './queries'

/**
 * "Também neste recebível" — as etiquetas do detalhe (NF > pré-autorização > título).
 *
 * O funil mostra um card só quando as três fontes trazem o mesmo documento; estas
 * etiquetas dizem quais outros existem e em que estado estão, no cabeçalho dos dois
 * modais (`NotaModal` e `OportunidadeModal`). Sem nenhum outro documento, nada
 * aparece — a linha não vira ruído no card comum.
 */
export function DocumentosDoRecebivel({
  tipo,
  id,
  aberto,
}: {
  tipo: TipoOportunidade
  id: string
  aberto: boolean
}) {
  const { data } = useQuery({
    queryKey: antecipacaoKeys.documentosDoRecebivel(tipo, id),
    queryFn: () => buscarDocumentosDoRecebivel(tipo, id),
    enabled: aberto,
    staleTime: 60_000,
  })

  if (!data?.length) return null

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 print:hidden">
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Layers className="h-3 w-3" aria-hidden />
        Também neste recebível:
      </span>
      {data.map((d) => {
        const estado =
          d.estado === null
            ? null
            : d.tipo === 'pre_autorizacao'
              ? (STATUS_PRE_AUTORIZACAO_LABELS[d.estado] ?? d.estado)
              : (SITUACAO_TITULO_LABELS[d.estado] ?? d.estado)
        return (
          <Badge key={`${d.tipo}:${d.id}`} variant="outline" className="text-[11px] font-normal">
            {d.rotulo}
            {estado ? <span className="text-muted-foreground">&nbsp;· {estado}</span> : null}
          </Badge>
        )
      })}
    </div>
  )
}
