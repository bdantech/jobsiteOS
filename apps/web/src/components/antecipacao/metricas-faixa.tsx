'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { FAIXA_LABELS, type Faixa } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { FAIXA_BADGE, formatarInteiro, formatarMoeda, formatarPercentual } from './format'
import { antecipacaoKeys, buscarMetricasFaixa, type MetricaFaixa } from './queries'

/**
 * Métricas por faixa (§5) — o funil dentro do funil:
 *
 *   entrou_na_faixa → contatada → respondeu → antecipou
 *
 * É ISTO que permite regular os critérios com dados. Sem esta tela, "a faixa boa
 * está boa?" só tem resposta por impressão, e as regras de faixa ficam sendo o que
 * alguém achou em janeiro para sempre.
 *
 * As etapas são derivadas do ESTÁGIO, não de um contador próprio: contatada = saiu
 * de "a prospectar"; respondeu = chegou a "em negociação" ou além; antecipou =
 * convertida. Um contador separado seria uma segunda verdade que divergiria do
 * Kanban na primeira correção manual.
 */

function Etapa({
  label,
  valor,
  base,
  destaque,
}: {
  label: string
  valor: number
  base: number
  destaque?: boolean
}) {
  const pct = base > 0 ? (valor / base) * 100 : 0
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn('text-sm tabular-nums', destaque && 'font-medium')}>
          {formatarInteiro(valor)}
          <span className="ml-1 text-xs text-muted-foreground">{formatarPercentual(valor, base)}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', destaque ? 'bg-emerald-500' : 'bg-primary/60')}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  )
}

function CardFaixa({ m }: { m: MetricaFaixa }) {
  const faixa = m.faixa as Faixa | 'sem_faixa'
  const ehFaixa = faixa !== 'sem_faixa'

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {ehFaixa ? (
            <Badge className={FAIXA_BADGE[faixa]}>{FAIXA_LABELS[faixa]}</Badge>
          ) : (
            <Badge variant="secondary">Fora das faixas</Badge>
          )}
          {m.regra_versao !== null && (
            <Badge variant="outline" className="tabular-nums">
              regra v{m.regra_versao}
            </Badge>
          )}
        </div>
        <CardDescription className="tabular-nums">
          {formatarInteiro(m.notas)} notas · {formatarMoeda(m.valor)} · receita esperada{' '}
          {formatarMoeda(m.receita_esperada)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Etapa label="Entrou na faixa" valor={m.notas} base={m.notas} />
        <Etapa label="Contatada" valor={m.contatadas} base={m.notas} />
        <Etapa label="Respondeu" valor={m.responderam} base={m.notas} />
        <Etapa label="Antecipou" valor={m.convertidas} base={m.notas} destaque />

        <dl className="grid grid-cols-3 gap-2 border-t pt-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Convertido</dt>
            <dd className="tabular-nums font-medium">{formatarMoeda(m.valor_convertido)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Perdidas</dt>
            <dd className="tabular-nums">{formatarInteiro(m.perdidas)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Expiradas</dt>
            <dd className="tabular-nums">{formatarInteiro(m.expiradas)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}

export function MetricasFaixa() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.metricas(),
    queryFn: buscarMetricasFaixa,
  })

  if (isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-72 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar as métricas.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="font-medium">Nenhuma nota classificada ainda</p>
          <p className="max-w-md text-sm text-muted-foreground">
            As métricas aparecem depois do primeiro sync de notas fiscais e da primeira
            reclassificação.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Uma faixa pode ter mais de uma linha (versões de regra diferentes convivendo
  // nas notas). Isso é uma FEATURE: é como se compara v1 com v2.
  const total = data.reduce((s, m) => s + m.notas, 0)
  const convertidas = data.reduce((s, m) => s + m.convertidas, 0)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Conversão geral</CardTitle>
          <CardDescription className="tabular-nums">
            {formatarInteiro(convertidas)} de {formatarInteiro(total)} notas antecipadas (
            {formatarPercentual(convertidas, total)}). Linhas separadas por versão de regra existem
            para comparar critérios — é assim que se descobre se a v2 melhorou algo.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.map((m) => (
          <CardFaixa key={`${m.faixa}-${m.regra_versao ?? 'sem'}`} m={m} />
        ))}
      </div>
    </div>
  )
}
