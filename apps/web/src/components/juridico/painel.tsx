'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, PauseCircle } from 'lucide-react'
import {
  BENCHMARK_FASES_PADRAO,
  FASES,
  SITUACAO_INTERNA_LABELS,
  situacaoEhAtiva,
  type BenchmarkFases,
  type Fase,
  type SituacaoInterna,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarCarteira, buscarJuridicoConfig, juridicoKeys } from './queries'
import { brl, faseLabel, haDias } from './format'

/**
 * Painel do Jurídico (08 §8).
 *
 * ── OS QUATRO NÚMEROS DO TOPO CONTAM UMA HISTÓRIA, NESTA ORDEM ─────────────
 * Em litígio → atualizado → recuperado no ano → custo acumulado. É a sequência da
 * pergunta que o gestor faz: quanto está em jogo, quanto isso vale hoje, quanto
 * voltou e quanto custou para voltar. Trocar a ordem — pondo o recuperado primeiro,
 * por exemplo — faria a carteira parecer um centro de receita.
 *
 * O saldo líquido fecha a linha porque é o único deles que pode ser NEGATIVO, e é
 * ele que responde se a operação judicial se paga.
 */

export function PainelJuridico() {
  const carteira = useQuery({ queryKey: juridicoKeys.carteira(), queryFn: buscarCarteira })
  const config = useQuery({ queryKey: juridicoKeys.config(), queryFn: buscarJuridicoConfig })

  const benchmark = ((config.data?.benchmark_fases as BenchmarkFases | undefined) ??
    BENCHMARK_FASES_PADRAO) as BenchmarkFases
  const diasParado =
    (config.data?.monitoramento as { dias_sem_movimentacao?: number } | undefined)?.dias_sem_movimentacao ?? 60

  // Idem carteira.tsx: `?? []` seria um array novo por render, e ele é dependência
  // dos `useMemo` que agregam a carteira inteira.
  const linhas = React.useMemo(() => carteira.data ?? [], [carteira.data])
  const ativos = React.useMemo(
    () => linhas.filter((l) => situacaoEhAtiva(l.situacao_interna)),
    [linhas],
  )

  const anoAtual = new Date().getFullYear()

  const resumo = React.useMemo(() => {
    const porSituacao = new Map<string, { qtd: number; valor: number }>()
    const porFase = new Map<string, { qtd: number; valor: number }>()

    for (const l of linhas) {
      const s = porSituacao.get(l.situacao_interna ?? 'desconhecida') ?? { qtd: 0, valor: 0 }
      s.qtd++
      s.valor += Number(l.valor_atualizado ?? l.valor_causa ?? 0)
      porSituacao.set(l.situacao_interna ?? 'desconhecida', s)
    }
    for (const l of ativos) {
      const chave = l.fase_atual ?? 'sem_fase'
      const f = porFase.get(chave) ?? { qtd: 0, valor: 0 }
      f.qtd++
      f.valor += Number(l.valor_atualizado ?? l.valor_causa ?? 0)
      porFase.set(chave, f)
    }
    return { porSituacao, porFase }
  }, [linhas, ativos])

  const lentos = ativos.filter((l) => {
    const limite = l.fase_atual ? (benchmark[l.fase_atual as Fase] ?? null) : null
    return limite !== null && (l.dias_na_fase ?? 0) > limite
  })
  const parados = ativos
    .filter((l) => (l.dias_sem_movimentacao ?? 0) > diasParado)
    .sort((a, b) => (b.dias_sem_movimentacao ?? 0) - (a.dias_sem_movimentacao ?? 0))

  const topDevedores = React.useMemo(() => {
    const porDevedor = new Map<string, { nome: string; empresaId: string | null; valor: number; qtd: number }>()
    for (const l of ativos) {
      const chave = l.cnpj_devedor ?? l.devedor_nome ?? l.numero_cnj ?? 'sem-devedor'
      const d = porDevedor.get(chave) ?? {
        nome: l.devedor_nome ?? 'Devedor não identificado',
        empresaId: l.empresa_devedora_id,
        valor: 0,
        qtd: 0,
      }
      d.valor += Number(l.valor_atualizado ?? l.valor_causa ?? 0)
      d.qtd++
      porDevedor.set(chave, d)
    }
    return [...porDevedor.values()].sort((a, b) => b.valor - a.valor).slice(0, 10)
  }, [ativos])

  if (carteira.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const emLitigio = ativos.reduce((s, l) => s + Number(l.valor_causa ?? 0), 0)
  const atualizado = ativos.reduce((s, l) => s + Number(l.valor_atualizado ?? 0), 0)
  const semCalculo = ativos.filter((l) => l.valor_atualizado === null).length
  // O ano corrente e a carteira inteira, separados: "recuperado no ano" é a régua de
  // desempenho; o acumulado é história.
  const recuperadoAno = linhas.reduce((s, l) => s + Number(l.recuperado ?? 0), 0)
  const custo = linhas.reduce((s, l) => s + Number(l.custo_acumulado ?? 0), 0)
  const saldo = recuperadoAno - custo

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi rotulo="Total em litígio" valor={brl(emLitigio)} nota={`${ativos.length} processo(s) ativo(s)`} />
        <Kpi
          rotulo="Valor atualizado"
          valor={brl(atualizado)}
          // Sem esta nota, um "atualizado" menor que o "em litígio" pareceria uma
          // carteira encolhendo — quando é só cálculo que ninguém gerou.
          nota={semCalculo > 0 ? `${semCalculo} sem cálculo gerado` : 'todos com cálculo'}
        />
        <Kpi rotulo="Recuperado" valor={brl(recuperadoAno)} nota={`carteira inteira · ${anoAtual}`} />
        <Kpi rotulo="Custo acumulado" valor={brl(custo)} nota="custas, honorários, perícias" />
        <Kpi
          rotulo="Saldo líquido"
          valor={brl(saldo)}
          nota="recuperado − custos"
          tom={saldo < 0 ? 'negativo' : saldo > 0 ? 'positivo' : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Processos por fase (ativos)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[...FASES, 'sem_fase'].map((f) => {
              const v = resumo.porFase.get(f)
              if (!v) return null
              const maior = Math.max(...[...resumo.porFase.values()].map((x) => x.qtd), 1)
              return (
                <div key={f} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>{f === 'sem_fase' ? 'Sem fase detectada' : faseLabel(f)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {v.qtd} · {brl(v.valor)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(v.qtd / maior) * 100}%` }} />
                  </div>
                </div>
              )
            })}
            {resumo.porFase.size === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhum processo ativo.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Por situação interna</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[...resumo.porSituacao.entries()].map(([s, v]) => (
              <div key={s} className="flex items-center justify-between text-sm">
                <span>{SITUACAO_INTERNA_LABELS[s as SituacaoInterna] ?? s}</span>
                <span className="tabular-nums text-muted-foreground">
                  {v.qtd} · {brl(v.valor)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
              Fases lentas ({lentos.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {lentos.slice(0, 10).map((l) => (
              <Link key={l.numero_cnj} href={`/juridico/${l.numero_cnj}`} className="block text-sm hover:underline">
                <span className="font-medium">{l.devedor_nome ?? l.numero_cnj}</span>
                <span className="block text-xs text-muted-foreground">
                  {faseLabel(l.fase_atual)} {haDias(l.dias_na_fase)} · esperado{' '}
                  {l.fase_atual ? (benchmark[l.fase_atual as Fase] ?? '—') : '—'} dias
                </span>
              </Link>
            ))}
            {lentos.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma fase estourou o benchmark.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <PauseCircle className="h-4 w-4 text-amber-600" aria-hidden />
              Processos parados ({parados.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {parados.slice(0, 10).map((l) => (
              <Link key={l.numero_cnj} href={`/juridico/${l.numero_cnj}`} className="block text-sm hover:underline">
                <span className="font-medium">{l.devedor_nome ?? l.numero_cnj}</span>
                <span className="block text-xs text-muted-foreground">
                  sem movimentação {haDias(l.dias_sem_movimentacao)}
                </span>
              </Link>
            ))}
            {parados.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhum processo parado há mais de {diasParado} dias.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Maiores devedores (processos ativos)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {topDevedores.map((d) => (
            <div key={d.nome} className="flex items-center justify-between text-sm">
              {d.empresaId ? (
                <Link href={`/empresas/${d.empresaId}`} className="hover:underline">
                  {d.nome}
                </Link>
              ) : (
                <span className="flex items-center gap-2">
                  {d.nome}
                  <Badge variant="outline" className="text-amber-600">
                    sem vínculo
                  </Badge>
                </span>
              )}
              <span className="tabular-nums">
                {brl(d.valor)}
                <span className="ml-2 text-xs text-muted-foreground">{d.qtd} ação(ões)</span>
              </span>
            </div>
          ))}
          {topDevedores.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nada em litígio.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function Kpi({
  rotulo,
  valor,
  nota,
  tom,
}: {
  rotulo: string
  valor: string
  nota?: string
  tom?: 'positivo' | 'negativo'
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{rotulo}</div>
        <div
          className={
            tom === 'negativo'
              ? 'text-xl font-semibold tabular-nums text-destructive'
              : tom === 'positivo'
                ? 'text-xl font-semibold tabular-nums text-emerald-600'
                : 'text-xl font-semibold tabular-nums'
          }
        >
          {valor}
        </div>
        {nota ? <div className="text-[11px] text-muted-foreground">{nota}</div> : null}
      </CardContent>
    </Card>
  )
}
