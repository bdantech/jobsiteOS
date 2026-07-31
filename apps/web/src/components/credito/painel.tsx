'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { FAIXA_SCORE_LABELS, type FaixaScore } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  backfillAtradiusAction,
  pollDecisoesAction,
  recalcularScoresAction,
  reestimarPotencialAction,
  rodarCreditoMensalAction,
  syncAtradiusAction,
} from '@/actions/credito'
import { cn } from '@/lib/utils'
import { buscarEsteira, buscarPainelCredito, buscarVersaoCredito, creditoKeys } from './queries'

/**
 * Painel do módulo (04d §5): pipeline de valor esperado por faixa de score e o funil da
 * esteira, com as taxas.
 *
 * O painel abre declarando quanto da base sequer tem score. Um pipeline de R$ esperados
 * sobre uma base majoritariamente sem pontuação é um número grande e vazio, e ele precisa
 * chegar acompanhado de quantas empresas ficaram de fora dele.
 */

const moeda = (v: number): string =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const FAIXA_CLASSE: Record<string, string> = {
  alta: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  media: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  improvavel: 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200',
  dados_insuficientes: 'bg-muted text-muted-foreground',
  sem_score: 'bg-muted text-muted-foreground',
}

interface CoefBruto {
  ratio_limite?: { global?: number | null; porTipo?: Record<string, number> }
  giro_mensal?: number | null
  n_clientes?: number
  n_declarantes?: number
}

export function CreditoPainel() {
  const qc = useQueryClient()
  const [rodando, setRodando] = React.useState<string | null>(null)

  const painel = useQuery({ queryKey: creditoKeys.painel(), queryFn: buscarPainelCredito })
  const versao = useQuery({ queryKey: creditoKeys.versao(), queryFn: buscarVersaoCredito })
  const esteira = useQuery({ queryKey: creditoKeys.esteira(), queryFn: buscarEsteira })

  async function rodar(rotulo: string, acao: () => Promise<{ ok: boolean; message?: string; data?: { enfileirado: boolean; aviso?: string } }>) {
    setRodando(rotulo)
    const r = await acao()
    setRodando(null)
    if (!r.ok) {
      toast.error(r.message ?? 'Falhou.')
      return
    }
    if (r.data && !r.data.enfileirado) {
      toast.error(r.data.aviso ?? 'O worker não aceitou o job.')
      return
    }
    toast.success(`${rotulo} disparado.`)
    void qc.invalidateQueries({ queryKey: creditoKeys.all })
  }

  if (painel.isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  if (painel.isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {painel.error instanceof Error ? painel.error.message : 'Erro ao carregar o painel.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const p = painel.data
  const coef = (versao.data?.coeficientes ?? null) as CoefBruto | null
  const semCalibracao = !versao.data || coef?.ratio_limite?.global === null || coef?.ratio_limite?.global === undefined

  const analises = esteira.data ?? []
  const conta = (estagios: string[]) => analises.filter((a) => estagios.includes(a.estagio)).length
  // O funil conta SÓ o que nasceu na esteira: incluir o backfill da apólice inflaria a
  // taxa de aprovação com decisões que este fluxo não tomou.
  const daEsteira = analises.filter((a) => a.origem === 'jobsiteos')
  const solicitadas = daEsteira.length
  const enviadas = daEsteira.filter((a) =>
    ['enviada_seguradora', 'em_analise', 'aprovada', 'aprovada_parcial', 'negada', 'expirada'].includes(a.estagio),
  ).length
  const aprovadas = daEsteira.filter((a) => ['aprovada', 'aprovada_parcial'].includes(a.estagio)).length

  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—')

  return (
    <div className="space-y-4">
      {semCalibracao && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="space-y-1 py-4 text-sm">
            <p className="font-medium">O limite potencial ainda não pode ser calculado.</p>
            <p className="text-muted-foreground">
              A proporção <strong>limite ÷ faturamento</strong> é calibrada nos clientes que
              DECLARARAM faturamento, e ainda não há nenhum. Sem essa régua, nenhum limite é
              gravado — de propósito: um coeficiente inventado preencheria a base inteira de
              números plausíveis e errados.{' '}
              {coef?.giro_mensal
                ? `O giro da carteira, esse sim, já saiu do real: ${(coef.giro_mensal * 100).toFixed(1)}% do limite por mês.`
                : ''}
            </p>
            <p className="text-muted-foreground">
              O caminho é declarar o faturamento de alguns clientes na Company 360 e rodar
              &ldquo;Recalibrar e recalcular&rdquo;.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Pipeline de valor esperado</CardTitle>
              <CardDescription>
                R$ esperados por mês = receita prevista × chance de concessão. É a régua que
                substitui &ldquo;parece bom&rdquo; — e ela só vale sobre a parte da base que
                tem score.
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={rodando !== null}
                onClick={() => void rodar('Recalibrar e recalcular', rodarCreditoMensalAction)}
              >
                <RefreshCw className={cn('mr-1 h-3.5 w-3.5', rodando !== null && 'animate-spin')} aria-hidden />
                Recalibrar e recalcular
              </Button>
              <Button variant="outline" size="sm" disabled={rodando !== null} onClick={() => void rodar('Recalcular scores', recalcularScoresAction)}>
                Só scores
              </Button>
              <Button variant="outline" size="sm" disabled={rodando !== null} onClick={() => void rodar('Reestimar potencial', reestimarPotencialAction)}>
                Só potencial
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Sacados</p>
              <p className="text-xl font-semibold tabular-nums">{p.sacados.toLocaleString('pt-BR')}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Com score</p>
              <p className="text-xl font-semibold tabular-nums">{p.com_score.toLocaleString('pt-BR')}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Dados insuficientes</p>
              <p className="text-xl font-semibold tabular-nums">{p.dados_insuficientes.toLocaleString('pt-BR')}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Com limite</p>
              <p className="text-xl font-semibold tabular-nums">{p.com_limite.toLocaleString('pt-BR')}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Faixa</TableHead>
                  <TableHead className="text-right">Empresas</TableHead>
                  <TableHead className="text-right">Valor esperado / mês</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(p.por_faixa)
                  .sort((a, b) => b[1].valor_esperado - a[1].valor_esperado || b[1].qtd - a[1].qtd)
                  .map(([faixa, v]) => (
                    <TableRow key={faixa}>
                      <TableCell>
                        <Badge className={cn('text-[11px]', FAIXA_CLASSE[faixa])}>
                          {faixa === 'sem_score'
                            ? 'Ainda não pontuada'
                            : (FAIXA_SCORE_LABELS[faixa as FaixaScore] ?? faixa)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{v.qtd.toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-right tabular-nums">{moeda(v.valor_esperado)}</TableCell>
                    </TableRow>
                  ))}
                <TableRow>
                  <TableCell className="font-medium">Total</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {p.sacados.toLocaleString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {moeda(p.valor_esperado_total)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Funil da esteira</CardTitle>
              <CardDescription>
                Só o que <strong>nasceu aqui</strong>. As análises trazidas do backfill da
                apólice ficam de fora: elas inflariam a taxa de aprovação com decisões que este
                fluxo não tomou.
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={rodando !== null} onClick={() => void rodar('Consulta de decisões', pollDecisoesAction)}>
                Consultar decisões
              </Button>
              <Button variant="outline" size="sm" disabled={rodando !== null} onClick={() => void rodar('Sync da apólice', syncAtradiusAction)}>
                Sync da apólice
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={rodando !== null}
                onClick={() => void rodar('Backfill da apólice', backfillAtradiusAction)}
                title="Lê os limites e as decisões que a apólice já tem. Não descobre buyer novo."
              >
                Backfill
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Solicitadas</p>
              <p className="text-xl font-semibold tabular-nums">{solicitadas}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Enviadas</p>
              <p className="text-xl font-semibold tabular-nums">{enviadas}</p>
              <p className="text-[11px] text-muted-foreground">{pct(enviadas, solicitadas)} das solicitadas</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Aprovadas</p>
              <p className="text-xl font-semibold tabular-nums">{aprovadas}</p>
              <p className="text-[11px] text-muted-foreground">{pct(aprovadas, enviadas)} das enviadas</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Aguardando decisão</p>
              <p className="text-xl font-semibold tabular-nums">
                {conta(['enviada_seguradora', 'em_analise'])}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
