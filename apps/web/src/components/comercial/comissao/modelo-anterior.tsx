'use client'

import { useQuery } from '@tanstack/react-query'
import {
  ORIGEM_LANCAMENTO_LABELS,
  STATUS_LANCAMENTO_LABELS,
  type OrigemLancamento,
  type StatusLancamento,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'
import { brl, mesDaCompetencia } from './format'

/**
 * As competências do 04g, read-only (§9).
 *
 * Elas NÃO são recalculadas. A régua nova (VOP, fases, sunset) descreve um acordo que não
 * existia naquele mês, e reprocessar mudaria o número de uma folha que já foi paga — o
 * tipo de correção que quem recebeu lê como erro, e com razão. O que a tela faz é dizer
 * de onde veio cada número.
 */

interface LinhaAntiga {
  competencia: string
  vendedor: string
  origem_tipo: string
  descricao: string | null
  valor: number
  status: string
}

async function buscarAntigas(): Promise<LinhaAntiga[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('comissao_lancamentos')
    .select('competencia, origem_tipo, descricao, valor, status, vendedores(nome)')
    .order('competencia', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []).map((l) => ({
    competencia: l.competencia,
    vendedor: (l.vendedores as { nome?: string } | null)?.nome ?? '—',
    origem_tipo: l.origem_tipo,
    descricao: l.descricao,
    valor: Number(l.valor),
    status: l.status,
  }))
}

export function ComissoesAntigas() {
  const { data, isPending } = useQuery({
    queryKey: ['comercial', 'comissao-antiga'],
    queryFn: buscarAntigas,
  })

  if (isPending) return <Skeleton className="h-64 w-full" />

  const linhas = data ?? []
  if (linhas.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhum lançamento no modelo anterior. Tudo o que existe já nasceu no motor v2.
        </CardContent>
      </Card>
    )
  }

  const porCompetencia = new Map<string, LinhaAntiga[]>()
  for (const l of linhas) {
    const atual = porCompetencia.get(l.competencia) ?? []
    atual.push(l)
    porCompetencia.set(l.competencia, atual)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Modelo anterior (04g)</CardTitle>
          <Badge variant="secondary" className="text-[10px]">somente leitura</Badge>
        </div>
        <CardDescription>
          Valor fixo por milhão convertido e SDR por reunião agendada. Estas competências
          NÃO foram recalculadas pela régua nova: reprocessar mudaria o número de uma folha
          já paga.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {[...porCompetencia.entries()].map(([competencia, ls]) => (
            <li key={competencia} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{mesDaCompetencia(competencia)}</span>
                <span className="text-sm tabular-nums">
                  {brl(ls.reduce((s, l) => s + l.valor, 0))}
                </span>
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {ls.map((l, i) => (
                  <li key={`${competencia}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>
                      {l.vendedor} ·{' '}
                      {ORIGEM_LANCAMENTO_LABELS[l.origem_tipo as OrigemLancamento] ?? l.origem_tipo}
                      {l.descricao ? ` — ${l.descricao}` : ''}
                    </span>
                    <span className="flex items-center gap-2">
                      <span>{STATUS_LANCAMENTO_LABELS[l.status as StatusLancamento] ?? l.status}</span>
                      <span className="tabular-nums">{brl(l.valor)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
