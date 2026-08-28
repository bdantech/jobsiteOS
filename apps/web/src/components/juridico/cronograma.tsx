'use client'

import { AlertTriangle } from 'lucide-react'
import { FASES, montarCronograma, type BenchmarkFases, type Fase } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { data, faseLabel } from './format'

/**
 * O cronograma da ação (08 §5): uma barra por fase, com o tempo decorrido em cada uma
 * e o total desde a distribuição.
 *
 * ── A LARGURA É PROPORCIONAL AO TEMPO, E É ESSE O PONTO ────────────────────
 * Barras de largura igual desenhariam um processo de dez anos e um de seis meses do
 * mesmo jeito. O que a tela precisa mostrar num relance é ONDE o processo travou —
 * e isso é uma barra que ocupa metade da linha.
 *
 * ── AS FASES NÃO ALCANÇADAS APARECEM APAGADAS ──────────────────────────────
 * Mostrar só as percorridas esconderia quanto falta. Uma execução na citação e uma
 * no leilão são situações opostas, e sem a régua inteira as duas desenham a mesma
 * barra sozinha na tela.
 */

export function Cronograma({
  movimentacoes,
  benchmark,
}: {
  movimentacoes: { data: string; fase_detectada: string | null }[]
  benchmark: BenchmarkFases
}) {
  const c = montarCronograma(movimentacoes, benchmark)

  if (c.etapas.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Cronograma da ação</CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Nenhuma movimentação classificada ainda. O cronograma aparece quando a sincronização trouxer
          andamentos que o classificador reconheça — não quer dizer que o processo esteja parado.
        </CardContent>
      </Card>
    )
  }

  const maiorEtapa = Math.max(...c.etapas.map((e) => e.dias), 1)
  const alcancadas = new Set(c.etapas.map((e) => e.fase))

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Cronograma da ação</CardTitle>
        <span className="text-xs text-muted-foreground">
          {c.dias_total} dias desde a primeira fase detectada
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {c.etapas.map((e) => (
          <div key={`${e.fase}-${e.desde}`} className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium">
                {faseLabel(e.fase)}
                {e.ate === null ? <span className="ml-2 text-muted-foreground">(atual)</span> : null}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {e.dias} dias
                {e.benchmark !== null ? ` · esperado ${e.benchmark}` : ''}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full', e.estourou ? 'bg-destructive' : 'bg-primary')}
                style={{ width: `${Math.max(3, (e.dias / maiorEtapa) * 100)}%` }}
              />
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>
                {data(e.desde)} → {e.ate ? data(e.ate) : 'hoje'}
              </span>
              {e.estourou ? (
                <Badge variant="destructive" className="gap-1 py-0 text-[10px]">
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  {e.ate === null ? 'estourou o prazo esperado' : 'demorou mais que o esperado'}
                </Badge>
              ) : null}
            </div>
          </div>
        ))}

        {/* As fases que ainda não vieram, apagadas: é o que falta do caminho. */}
        <div className="flex flex-wrap gap-1 pt-2">
          {FASES.filter((f) => !alcancadas.has(f as Fase)).map((f) => (
            <Badge key={f} variant="outline" className="text-[10px] text-muted-foreground/60">
              {faseLabel(f)}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
