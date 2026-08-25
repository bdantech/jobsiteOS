'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  PAPEIS_COMISSAO,
  PAPEL_COMISSAO_LABELS,
  STATUS_COMPETENCIA_LABELS,
  type StatusCompetencia,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { mudarStatusCompetenciaAction } from '@/actions/comercial'
import { buscarPainelComissao, comissaoKeys } from '../queries-comissao'
import { brl, mesDaCompetencia, numero } from './format'

/**
 * Doze meses, um por linha, com o status de cada competência.
 *
 * A barra é proporcional ao maior mês da série, e não a uma escala fixa: o que a pessoa
 * quer ver aqui é a FORMA da série — em que mês caiu, em que mês subiu — e uma escala
 * absoluta achataria doze meses parecidos numa linha reta.
 *
 * Aprovar e pagar são por competência inteira. Aprovar quarenta linhas uma a uma é o
 * tipo de tarefa que leva alguém a aprovar sem ler.
 */

const CORES: Record<StatusCompetencia, string> = {
  aberta: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  fechada: 'bg-slate-100 text-slate-900 dark:bg-slate-500/20 dark:text-slate-200',
  aprovada: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200',
  paga: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
}

export function Historico({
  vendedorId,
  ehGestor,
  onAbrirCompetencia,
}: {
  vendedorId: string | null
  ehGestor: boolean
  onAbrirCompetencia: (competencia: string) => void
}) {
  const qc = useQueryClient()
  const [agindo, setAgindo] = React.useState(false)
  const { data, isPending } = useQuery({
    queryKey: comissaoKeys.painel(vendedorId),
    queryFn: () => buscarPainelComissao(vendedorId),
  })

  async function mudar(competencia: string, status: 'aprovada' | 'paga') {
    setAgindo(true)
    const r = await mudarStatusCompetenciaAction({ competencia, status })
    setAgindo(false)
    if (!r.ok) return toast.error(r.message)
    toast.success(
      r.data.linhas === 0
        ? 'Competência marcada — nenhuma linha estava no estado anterior.'
        : `${r.data.linhas} lançamento(s) → ${status}.`,
    )
    void qc.invalidateQueries({ queryKey: ['comercial', 'comissao-v2'] })
  }

  if (isPending) return <Skeleton className="h-64 w-full" />

  const serie = data?.historico ?? []
  if (serie.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Ainda não há competência com lançamento. O extrato começa a se montar na primeira
          NF convertida.
        </CardContent>
      </Card>
    )
  }
  const maior = Math.max(...serie.map((h) => Math.abs(h.total)), 1)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Mês a mês</CardTitle>
        <CardDescription>
          Competência fechada é IMUTÁVEL: um estorno descoberto depois entra como linha
          negativa no mês corrente, nunca reescreve o passado.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {serie.map((h) => {
            const largura = Math.max(2, (Math.abs(h.total) / maior) * 100)
            return (
              <li key={h.competencia} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onAbrirCompetencia(h.competencia)}
                    className="text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {mesDaCompetencia(h.competencia)}
                  </button>
                  <span className="flex items-center gap-2">
                    <Badge className={`text-[10px] ${CORES[h.status]}`}>
                      {STATUS_COMPETENCIA_LABELS[h.status]}
                    </Badge>
                    <span className="text-sm tabular-nums">{brl(h.total)}</span>
                  </span>
                </div>

                <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted">
                  <div
                    className={`h-1.5 rounded-full ${h.total < 0 ? 'bg-destructive' : 'bg-primary'}`}
                    style={{ width: `${largura}%` }}
                  />
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {PAPEIS_COMISSAO.filter((p) => (h.por_papel[p] ?? 0) !== 0).map((p) => (
                    <span key={p}>
                      {PAPEL_COMISSAO_LABELS[p]}: <span className="tabular-nums">{brl(h.por_papel[p])}</span>
                    </span>
                  ))}
                  <span>{numero(h.lancamentos)} lançamento(s)</span>
                  {ehGestor && h.status === 'fechada' ? (
                    <Button size="sm" className="h-6 text-xs" disabled={agindo}
                      onClick={() => void mudar(h.competencia, 'aprovada')}>
                      Aprovar
                    </Button>
                  ) : null}
                  {ehGestor && h.status === 'aprovada' ? (
                    <Button size="sm" variant="outline" className="h-6 text-xs" disabled={agindo}
                      onClick={() => void mudar(h.competencia, 'paga')}>
                      Marcar paga
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
