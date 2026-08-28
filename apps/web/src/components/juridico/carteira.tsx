'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Gavel,
  LayoutGrid,
  List,
  Link2Off,
  Search,
} from 'lucide-react'
import {
  BENCHMARK_FASES_PADRAO,
  COLUNAS_JURIDICO,
  SITUACAO_INTERNA_LABELS,
  type BenchmarkFases,
  type Fase,
  type SituacaoInterna,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { buscarCarteira, buscarJuridicoConfig, juridicoKeys, type LinhaCarteira } from './queries'
import { brl, data, faseLabel, haDias, situacaoLabel } from './format'

/**
 * A carteira judicial (08 §8): lista e kanban sobre os MESMOS dados filtrados.
 *
 * ── POR QUE OS DOIS ────────────────────────────────────────────────────────
 * O kanban responde "como está distribuída a carteira" num relance; a lista responde
 * "qual processo eu abro agora", porque só ela mostra valor, fase, dias parado e
 * advogado lado a lado. Escolher um só obrigaria a tela a mentir sobre uma das duas
 * perguntas — e a segunda é a que a pessoa faz toda manhã.
 *
 * O filtro é aplicado ANTES da divisão em colunas, não depois: um kanban que ignora
 * o filtro mostra colunas cheias enquanto a lista ao lado está vazia.
 */

type Visao = 'lista' | 'kanban'

function Lentidao({ linha, benchmark }: { linha: LinhaCarteira; benchmark: BenchmarkFases }) {
  const limite = linha.fase_atual ? (benchmark[linha.fase_atual as Fase] ?? null) : null
  const estourou = limite !== null && (linha.dias_na_fase ?? 0) > limite
  if (!estourou) return null
  return (
    <Badge variant="destructive" className="ml-2 gap-1" title={`Esperado: ${limite} dias nesta fase.`}>
      <AlertTriangle className="h-3 w-3" aria-hidden />
      {linha.dias_na_fase}d
    </Badge>
  )
}

export function Carteira() {
  const [visao, setVisao] = React.useState<Visao>('lista')
  const [busca, setBusca] = React.useState('')
  const [situacao, setSituacao] = React.useState<string>('todas')
  const [uf, setUf] = React.useState<string>('todas')
  const [advogado, setAdvogado] = React.useState<string>('todos')
  const [fase, setFase] = React.useState<string>('todas')

  const carteira = useQuery({ queryKey: juridicoKeys.carteira(), queryFn: buscarCarteira })
  const config = useQuery({ queryKey: juridicoKeys.config(), queryFn: buscarJuridicoConfig })

  const benchmark = ((config.data?.benchmark_fases as BenchmarkFases | undefined) ??
    BENCHMARK_FASES_PADRAO) as BenchmarkFases

  /*
   * `?? []` cria um array NOVO a cada render, e ele é dependência de quatro `useMemo`
   * — que por isso recalculariam sempre, sobre uma carteira de até 2.000 linhas.
   */
  const linhas = React.useMemo(() => carteira.data ?? [], [carteira.data])

  const ufs = React.useMemo(
    () => [...new Set(linhas.map((l) => l.uf).filter((u): u is string => !!u))].sort(),
    [linhas],
  )
  const advogados = React.useMemo(
    () => [...new Set(linhas.map((l) => l.advogado_nome).filter((a): a is string => !!a))].sort(),
    [linhas],
  )
  const fases = React.useMemo(
    () => [...new Set(linhas.map((l) => l.fase_atual).filter((f): f is string => !!f))],
    [linhas],
  )

  const filtradas = React.useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return linhas.filter((l) => {
      if (situacao !== 'todas' && l.situacao_interna !== situacao) return false
      if (uf !== 'todas' && l.uf !== uf) return false
      if (advogado !== 'todos' && l.advogado_nome !== advogado) return false
      if (fase !== 'todas' && l.fase_atual !== fase) return false
      if (!termo) return true
      return (
        (l.numero_cnj ?? '').toLowerCase().includes(termo) ||
        (l.devedor_nome ?? '').toLowerCase().includes(termo) ||
        (l.cnpj_devedor ?? '').includes(termo.replace(/\D/g, '')) ||
        (l.classe ?? '').toLowerCase().includes(termo)
      )
    })
  }, [linhas, busca, situacao, uf, advogado, fase])

  const semVinculo = filtradas.filter((l) => !l.empresa_devedora_id).length

  if (carteira.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  if (carteira.isError) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Não foi possível carregar a carteira.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            className="pl-8"
            placeholder="CNJ, devedor, CNPJ ou classe"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar processo"
          />
        </div>

        <Select value={situacao} onValueChange={setSituacao}>
          <SelectTrigger className="w-[170px]" aria-label="Situação">
            <SelectValue placeholder="Situação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as situações</SelectItem>
            {COLUNAS_JURIDICO.map((s) => (
              <SelectItem key={s} value={s}>
                {SITUACAO_INTERNA_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={fase} onValueChange={setFase}>
          <SelectTrigger className="w-[190px]" aria-label="Fase">
            <SelectValue placeholder="Fase" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as fases</SelectItem>
            {fases.map((f) => (
              <SelectItem key={f} value={f}>
                {faseLabel(f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={uf} onValueChange={setUf}>
          <SelectTrigger className="w-[110px]" aria-label="UF">
            <SelectValue placeholder="UF" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            {ufs.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={advogado} onValueChange={setAdvogado}>
          <SelectTrigger className="w-[180px]" aria-label="Advogado">
            <SelectValue placeholder="Advogado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os advogados</SelectItem>
            {advogados.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex rounded-md border border-border">
          <Button
            variant={visao === 'lista' ? 'secondary' : 'ghost'}
            size="sm"
            className="rounded-r-none"
            onClick={() => setVisao('lista')}
            aria-label="Ver como lista"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={visao === 'kanban' ? 'secondary' : 'ghost'}
            size="sm"
            className="rounded-l-none"
            onClick={() => setVisao('kanban')}
            aria-label="Ver como kanban"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/*
       * A fila de vinculação manual (§3) fica NO TOPO e não numa aba: um processo sem
       * empresa vinculada some da Company 360 do devedor e não conta para o knockout
       * de crédito. É o defeito mais caro deste módulo, e ele não pode depender de
       * alguém lembrar de procurar por ele.
       */}
      {semVinculo > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 py-3 text-sm">
            <Link2Off className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <span>
              <strong>{semVinculo}</strong> processo(s) sem empresa vinculada. Enquanto isso durar, eles não
              aparecem na ficha do devedor nem bloqueiam crédito para ele. Abra cada um e vincule pelo CNPJ.
            </span>
          </CardContent>
        </Card>
      ) : null}

      {filtradas.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <Gavel className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {linhas.length === 0
                ? 'Nenhum processo importado ainda. Cadastre os nossos CNPJs em Configurações e rode a descoberta.'
                : 'Nenhum processo com estes filtros.'}
            </p>
          </CardContent>
        </Card>
      ) : visao === 'lista' ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Processo</TableHead>
                  <TableHead>Devedor</TableHead>
                  <TableHead className="text-right">Valor da causa</TableHead>
                  <TableHead className="text-right">Valor atualizado</TableHead>
                  <TableHead>Fase</TableHead>
                  <TableHead>Última mov.</TableHead>
                  <TableHead>Advogado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.map((l) => (
                  <TableRow key={l.numero_cnj}>
                    <TableCell>
                      <Link
                        href={`/juridico/${l.numero_cnj}`}
                        className="font-mono text-xs underline-offset-2 hover:underline"
                      >
                        {l.numero_cnj}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {[l.classe, l.comarca, l.uf].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </TableCell>
                    <TableCell>
                      {l.empresa_devedora_id ? (
                        <Link
                          href={`/empresas/${l.empresa_devedora_id}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {l.devedor_nome ?? '—'}
                        </Link>
                      ) : (
                        <span className="flex items-center gap-1">
                          {l.devedor_nome ?? '—'}
                          <Badge variant="outline" className="gap-1 text-amber-600">
                            <Link2Off className="h-3 w-3" aria-hidden />
                            sem vínculo
                          </Badge>
                        </span>
                      )}
                      <div className="text-xs text-muted-foreground">{situacaoLabel(l.situacao_interna)}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{brl(l.valor_causa)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.valor_atualizado === null ? (
                        // Nulo NÃO é zero: é ninguém ter gerado a memória de cálculo
                        // ainda, e isso é acionável.
                        <span className="text-xs text-muted-foreground">sem cálculo</span>
                      ) : (
                        brl(l.valor_atualizado)
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {faseLabel(l.fase_atual)}
                      <Lentidao linha={l} benchmark={benchmark} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {data(l.data_ultima_movimentacao)}
                      <div className="text-muted-foreground">{haDias(l.dias_sem_movimentacao)}</div>
                    </TableCell>
                    <TableCell className="text-xs">{l.advogado_nome ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUNAS_JURIDICO.map((coluna) => {
            const daColuna = filtradas.filter((l) => l.situacao_interna === coluna)
            const total = daColuna.reduce(
              (s, l) => s + Number(l.valor_atualizado ?? l.valor_causa ?? 0),
              0,
            )
            return (
              <div key={coluna} className="min-w-[260px] flex-1">
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <span className="text-sm font-medium">{SITUACAO_INTERNA_LABELS[coluna as SituacaoInterna]}</span>
                  <span className="text-xs text-muted-foreground">
                    {daColuna.length} · {brl(total)}
                  </span>
                </div>
                <div className="space-y-2">
                  {daColuna.map((l) => (
                    <Link key={l.numero_cnj} href={`/juridico/${l.numero_cnj}`} className="block">
                      <Card className="transition-colors hover:border-primary/50">
                        <CardContent className="space-y-1 p-3">
                          <div className="truncate text-sm font-medium">{l.devedor_nome ?? l.numero_cnj}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{l.numero_cnj}</div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-xs">{faseLabel(l.fase_atual)}</span>
                            <span className="text-xs tabular-nums">
                              {brl(l.valor_atualizado ?? l.valor_causa)}
                            </span>
                          </div>
                          <Lentidao linha={l} benchmark={benchmark} />
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                  {daColuna.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-muted-foreground">Vazia</p>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
