'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Landmark, ShieldQuestion } from 'lucide-react'
import {
  ESTAGIO_ANALISE_LABELS,
  FAIXA_SCORE_LABELS,
  KNOCKOUT_LABELS,
  MOTIVO_SEM_POTENCIAL_LABELS,
  ehEstagioDecidido,
  type EstagioAnalise,
  type FaixaScore,
  type Knockout,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { buscarEsteira, buscarScore, creditoKeys } from './queries'
import { SolicitarAnaliseDialog } from './solicitar-analise-dialog'

/**
 * Card "Crédito" da Company 360 (04d §3).
 *
 * O card inteiro existe para uma frase: **este número tem procedência**. Score com
 * breakdown fator a fator, limite com o motivo quando não há, confiança herdada à vista,
 * e a chance marcada como presumida quando foi presumida. Um valor esperado sem essas
 * quatro coisas chega ao vendedor com a autoridade de um fato, e ele é uma multiplicação
 * de estimativas.
 */

const FAIXA_CLASSE: Record<string, string> = {
  alta: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  media: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  improvavel: 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200',
  dados_insuficientes: 'bg-muted text-muted-foreground',
}

const moeda = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

interface LinhaBreakdown {
  fator?: string
  label?: string
  pontos?: number | null
  peso?: number
  observado?: string
  ressalva?: string
}

/** A barra do score. Cinza e vazia quando não há score — e a ausência é o recado. */
function BarraScore({ score, faixa }: { score: number | null; faixa: string }) {
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score))
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums">{score === null ? '—' : Math.round(score)}</span>
        <Badge className={cn('text-[11px]', FAIXA_CLASSE[faixa])}>
          {FAIXA_SCORE_LABELS[faixa as FaixaScore] ?? faixa}
        </Badge>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            faixa === 'alta' ? 'bg-emerald-500' : faixa === 'media' ? 'bg-amber-500' : 'bg-destructive',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export interface CreditoCardProps {
  empresaId: string
  cnpj: string
  tipo: string
  limitePotencial: number | null
  limiteConfianca: string | null
  receitaMensalPrevista: number | null
  /** Taxa mensal (%) que entrou na conta: a da própria empresa quando a conhecemos. */
  receitaTaxaAm: number | null
  valorEsperadoMensal: number | null
  chanceConcessao: number | null
  faturamentoEstimado: number | null
  creditoCalculadoEm: string | null
}

export function CreditoCard(props: CreditoCardProps) {
  const qc = useQueryClient()
  const [solicitando, setSolicitando] = React.useState(false)

  const score = useQuery({ queryKey: creditoKeys.score(props.cnpj), queryFn: () => buscarScore(props.cnpj) })
  const esteira = useQuery({ queryKey: creditoKeys.esteira(), queryFn: buscarEsteira })

  // O escopo é do prompt, não uma limitação de tela: "quanto de limite" é a pergunta de
  // SACADO. Fornecedor tem outra (adesão), e mostrar este card para ele seria oferecer
  // uma resposta para uma pergunta que ninguém fez.
  const ehSacado = props.tipo === 'construtora' || props.tipo === 'incorporadora'
  if (!ehSacado) return null

  const analise = (esteira.data ?? []).find((a) => a.cnpj === props.cnpj) ?? null
  const breakdown: LinhaBreakdown[] = Array.isArray(score.data?.breakdown)
    ? (score.data.breakdown as LinhaBreakdown[])
    : []

  const naoAvaliaveis = breakdown.filter((b) => b.pontos === null || b.pontos === undefined)
  const semScore = score.data?.score === null || score.data === null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4" aria-hidden />
              Crédito
            </CardTitle>
            <CardDescription>
              Quanto de limite esta empresa sustentaria, qual a chance de a seguradora conceder,
              e quanto isso vale por mês. Tudo aqui é <strong>estimativa encadeada</strong>: a
              confiança do limite é herdada do faturamento e não sobe pelo caminho.
            </CardDescription>
          </div>
          {/*
            ANÁLISE DECIDIDA NÃO É FIM DE LINHA, e a tela dizia que era.
            O card mostrava só o desfecho — "Negada", "Aprovada" — e ficava sem saída:
            quem estava olhando a negativa é justamente quem sabe o que mudou desde
            ela (balanço novo, protesto baixado, sócio trocado) e não tinha por onde
            pedir outra. O RPC já permitia; faltava a porta.

            O par fica junto de propósito: o desfecho continua sendo a informação
            principal, e "Nova análise" é a ação que ele sugere — não um botão solto
            em outro canto da página.
          */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {analise ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/credito/analises/${analise.id}`}>
                  {ESTAGIO_ANALISE_LABELS[analise.estagio as EstagioAnalise] ?? analise.estagio}
                </Link>
              </Button>
            ) : null}
            {/*
              Sem análise nenhuma, ou com uma já decidida. Enquanto uma está EM CURSO o
              botão some: o RPC recusa ("já existe uma análise em andamento"), e oferecer
              para depois recusar ensina que o sistema erra.
            */}
            {(analise === null || ehEstagioDecidido(analise.estagio)) && (
              <Button variant="outline" size="sm" onClick={() => setSolicitando(true)}>
                {analise ? 'Nova análise' : 'Solicitar análise'}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {score.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {/* ── Score ── */}
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Chance de concessão</p>
              {score.data ? (
                <>
                  <BarraScore score={score.data.score} faixa={score.data.faixa} />
                  <p className="text-[11px] text-muted-foreground">
                    Completude {Math.round(Number(score.data.completude) * 100)}% dos pesos
                    {score.data.scorecard_versao ? ` · scorecard v${score.data.scorecard_versao}` : ''}
                  </p>
                  {score.data.knockout && (
                    <p className="flex items-start gap-1.5 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      {KNOCKOUT_LABELS[score.data.knockout as Knockout] ?? score.data.knockout}
                    </p>
                  )}
                  {semScore && (
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      Score não exibido: os dados disponíveis não cobrem o mínimo. Um número
                      calculado sobre poucos fatores <em>parece</em> um score.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Ainda não pontuada.</p>
              )}
            </div>

            {/* ── Economia ── */}
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Potencial</p>
              {props.limitePotencial === null ? (
                <p className="text-xs text-muted-foreground">
                  <span className="block text-sm font-medium text-foreground">Sem limite calculado.</span>
                  {props.faturamentoEstimado === null
                    ? MOTIVO_SEM_POTENCIAL_LABELS.sem_faturamento
                    : MOTIVO_SEM_POTENCIAL_LABELS.sem_calibracao}
                </p>
              ) : (
                <>
                  <dl className="space-y-1 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-muted-foreground">Limite potencial</dt>
                      <dd className="font-semibold tabular-nums">{moeda(props.limitePotencial)}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-muted-foreground">
                        Receita prevista
                        {/*
                         * A taxa aparece junto do número porque ela é metade dele. Vem
                         * da análise de crédito desta empresa quando existe; senão, da
                         * padrão da carteira — e entre 1,9% e 2,6% há um terço de
                         * diferença na mesma previsão.
                         */}
                        {props.receitaTaxaAm === null ? null : (
                          <span
                            className="block text-xs"
                            title="Taxa mensal usada na conta: a monthlyRateD0 desta empresa quando ela já tem análise de crédito, senão a padrão da configuração."
                          >
                            a {props.receitaTaxaAm.toLocaleString('pt-BR')}% a.m.
                          </span>
                        )}
                      </dt>
                      <dd className="tabular-nums">{moeda(props.receitaMensalPrevista)}/mês</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-muted-foreground">Valor esperado</dt>
                      <dd className="font-semibold tabular-nums">{moeda(props.valorEsperadoMensal)}/mês</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {props.limiteConfianca && (
                      <Badge variant="outline" className="text-[10px]">
                        confiança {props.limiteConfianca}
                      </Badge>
                    )}
                    {props.chanceConcessao !== null && (
                      <Badge variant="outline" className="text-[10px]">
                        chance {Math.round(Number(props.chanceConcessao) * 100)}%
                        {semScore ? ' (presumida)' : ''}
                      </Badge>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Breakdown ── */}
        {breakdown.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Como o score foi montado</h4>
            <ul className="divide-y rounded-lg border">
              {breakdown.map((b, i) => (
                <li key={b.fator ?? i} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm">{b.label ?? b.fator}</p>
                    <p className="text-xs text-muted-foreground">{b.observado}</p>
                    {b.ressalva ? (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">{b.ressalva}</p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-sm tabular-nums',
                      b.pontos === null || b.pontos === undefined
                        ? 'italic text-muted-foreground'
                        : 'font-medium',
                    )}
                  >
                    {b.pontos === null || b.pontos === undefined ? 'não avaliável' : `+${b.pontos} de ${b.peso}`}
                  </span>
                </li>
              ))}
            </ul>
            {naoAvaliaveis.length > 0 && (
              // O que falta é a metade ACIONÁVEL da resposta: dá para ir buscar. Esconder
              // os não avaliáveis deixaria o score parecendo completo.
              <p className="text-xs text-muted-foreground">
                {naoAvaliaveis.length} fator(es) sem dado saíram da conta — não valeram zero, foram
                removidos do numerador e do denominador. Preencher qualquer um deles muda o score.
              </p>
            )}
          </div>
        )}

        {props.creditoCalculadoEm && (
          <p className="text-[11px] text-muted-foreground">
            Potencial calculado em {new Date(props.creditoCalculadoEm).toLocaleString('pt-BR')}.
          </p>
        )}
      </CardContent>

      {solicitando && (
        <SolicitarAnaliseDialog
          aberto
          onOpenChange={(v) => !v && setSolicitando(false)}
          empresaId={props.empresaId}
          limitePotencial={props.limitePotencial}
          ehNova={analise !== null}
          onSalvo={() => void qc.invalidateQueries({ queryKey: creditoKeys.esteira() })}
        />
      )}
    </Card>
  )
}
