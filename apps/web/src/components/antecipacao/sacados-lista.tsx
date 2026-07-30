'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink, FilterX } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { creditoBadge, formatarInteiro, formatarMoeda, labelCredito } from './format'
import { LIMITE_SACADOS, antecipacaoKeys, buscarSacados, type SacadoFunil } from './queries'
import {
  CREDITO_SEM,
  CREDITO_TODOS,
  excedenteDe,
  ordenarSacados,
  passaNoFiltro,
  usePreferenciasSacados,
} from './sacados-tabela'
import { CabecalhoOrdenavel } from './tabela-ordenavel'

/**
 * Visão por sacado (§5): limite disponível vs. DEMANDA DO PIPELINE.
 *
 * É a pergunta que decide se vale abordar: um sacado aprovado com R$ 200k de
 * limite e R$ 900k de notas em faixa contra ele não tem 900k de oportunidade —
 * tem 200k, e 700k de conversa com o time de Crédito. A barra de contenção mostra
 * isso sem que ninguém precise fazer a conta.
 */

function BarraContencao({ demanda, disponivel }: { demanda: number; disponivel: number }) {
  // A barra é relativa ao MAIOR dos dois, para que o excedente seja visível em vez
  // de ficar em 100% e esconder a proporção.
  const escala = Math.max(demanda, disponivel, 1)
  const pctDemanda = (demanda / escala) * 100
  const pctDisponivel = (disponivel / escala) * 100
  const estoura = demanda > disponivel

  return (
    <div className="min-w-[10rem] space-y-1">
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/40"
          style={{ width: `${pctDisponivel}%` }}
        />
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            estoura ? 'bg-destructive/70' : 'bg-primary/70',
          )}
          style={{ width: `${pctDemanda}%`, height: '50%', top: '25%' }}
        />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {formatarMoeda(demanda)} de {formatarMoeda(disponivel)}
      </p>
    </div>
  )
}

interface OpcaoCredito {
  valor: string
  label: string
  quantidade: number
}

/**
 * As opções saem dos DADOS, não de uma lista fixa. `credito_status` vem cru da API
 * da Onepay: um status novo apareceria no badge da linha e não no filtro, e o
 * recorte ficaria impossível de fazer justamente para o que mudou.
 */
function opcoesCredito(linhas: readonly SacadoFunil[], salvo: string): OpcaoCredito[] {
  const contagem = new Map<string, number>()
  for (const s of linhas) {
    const chave = s.credito_status ? s.credito_status.toUpperCase() : CREDITO_SEM
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1)
  }

  // O valor salvo entra mesmo com zero linhas: sem isso o Select abriria em branco
  // depois que o último sacado daquele status saiu da lista, e a pessoa não teria
  // como saber por que a tabela está vazia.
  if (salvo !== CREDITO_TODOS && !contagem.has(salvo)) contagem.set(salvo, 0)

  return [...contagem.entries()]
    .map(([valor, quantidade]) => ({
      valor,
      quantidade,
      label: valor === CREDITO_SEM ? 'Sem análise' : labelCredito(valor),
    }))
    .sort((a, b) => b.quantidade - a.quantidade || a.label.localeCompare(b.label, 'pt-BR'))
}

export function SacadosLista() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.sacados(),
    queryFn: buscarSacados,
  })

  const { prefs, atualizar, ordenarPor } = usePreferenciasSacados()

  const linhas = React.useMemo(() => {
    if (!data) return []
    return ordenarSacados(
      data.filter((s) => passaNoFiltro(s, prefs.credito)),
      prefs.coluna,
      prefs.dir,
    )
  }, [data, prefs.credito, prefs.coluna, prefs.dir])

  const opcoes = React.useMemo(
    () => (data ? opcoesCredito(data, prefs.credito) : []),
    [data, prefs.credito],
  )

  if (isPending) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar os sacados.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  const filtrando = prefs.credito !== CREDITO_TODOS
  // A contagem de estouro é a das linhas VISÍVEIS: com o filtro ligado, um número
  // que conta a base inteira não bate com nenhuma linha da tabela.
  const estourando = linhas.filter((s) => excedenteDe(s) > 0)
  const truncado = data.length >= LIMITE_SACADOS

  return (
    <Card>
      <CardHeader className="gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Capacidade por sacado</CardTitle>
          <CardDescription>
            Limite disponível de cada construtora contra a soma das notas em faixa contra ela.
            {estourando.length > 0 && (
              <>
                {' '}
                <strong className="text-destructive">
                  {estourando.length} sacado{estourando.length > 1 ? 's' : ''}
                </strong>{' '}
                com demanda acima do limite — cada um já gerou evento para Crédito.
              </>
            )}
            {filtrando && (
              <>
                {' '}
                Mostrando <strong>{linhas.length}</strong> de {data.length} — o filtro fica salvo
                neste navegador.
              </>
            )}
          </CardDescription>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Select value={prefs.credito} onValueChange={(v) => atualizar({ credito: v })}>
            <SelectTrigger className="w-[13rem]" aria-label="Filtrar por status do crédito">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CREDITO_TODOS}>Todo status de crédito ({data.length})</SelectItem>
              {opcoes.map((o) => (
                <SelectItem key={o.valor} value={o.valor}>
                  {o.label} ({o.quantidade})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {filtrando && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => atualizar({ credito: CREDITO_TODOS })}
              aria-label="Limpar filtro"
              title="Limpar filtro"
            >
              <FilterX className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <CabecalhoOrdenavel
                  coluna="nome"
                  ativa={prefs.coluna}
                  dir={prefs.dir}
                  onClick={ordenarPor}
                >
                  Sacado
                </CabecalhoOrdenavel>
                <CabecalhoOrdenavel
                  coluna="credito"
                  ativa={prefs.coluna}
                  dir={prefs.dir}
                  onClick={ordenarPor}
                >
                  Crédito
                </CabecalhoOrdenavel>
                <CabecalhoOrdenavel
                  coluna="notas"
                  ativa={prefs.coluna}
                  dir={prefs.dir}
                  onClick={ordenarPor}
                  className="text-right"
                >
                  Notas
                </CabecalhoOrdenavel>
                <CabecalhoOrdenavel
                  coluna="fornecedores"
                  ativa={prefs.coluna}
                  dir={prefs.dir}
                  onClick={ordenarPor}
                  className="text-right"
                >
                  Fornecedores
                </CabecalhoOrdenavel>
                <CabecalhoOrdenavel
                  coluna="demanda"
                  ativa={prefs.coluna}
                  dir={prefs.dir}
                  onClick={ordenarPor}
                >
                  Demanda vs. limite
                </CabecalhoOrdenavel>
                <CabecalhoOrdenavel
                  coluna="excedente"
                  ativa={prefs.coluna}
                  dir={prefs.dir}
                  onClick={ordenarPor}
                  className="text-right"
                >
                  Excedente
                </CabecalhoOrdenavel>
                <CabecalhoOrdenavel
                  coluna="receita"
                  ativa={prefs.coluna}
                  dir={prefs.dir}
                  onClick={ordenarPor}
                  className="text-right"
                >
                  Receita esperada
                </CabecalhoOrdenavel>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                    {filtrando ? (
                      <>
                        Nenhum sacado com esse status de crédito.{' '}
                        <button
                          type="button"
                          className="underline underline-offset-2 hover:text-foreground"
                          onClick={() => atualizar({ credito: CREDITO_TODOS })}
                        >
                          Limpar filtro
                        </button>
                      </>
                    ) : (
                      'Nenhuma nota em faixa ainda — não há demanda de pipeline para comparar.'
                    )}
                  </TableCell>
                </TableRow>
              )}

              {linhas.map((s) => {
                const demanda = Number(s.demanda_pipeline ?? 0)
                const disponivel = Number(s.available_limit ?? 0)
                const excedente = excedenteDe(s)

                return (
                  <TableRow key={s.sacado_cnpj}>
                    <TableCell className="max-w-[16rem]">
                      <Link
                        href={`/antecipacao/sacados/${s.sacado_cnpj}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {s.sacado_nome ?? '—'}
                      </Link>
                      <p className="font-mono text-xs tabular-nums text-muted-foreground">
                        {s.sacado_cnpj ? formatCnpj(s.sacado_cnpj) : '—'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge className={creditoBadge(s.credito_status)}>
                        {labelCredito(s.credito_status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarInteiro(s.notas_em_faixa)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarInteiro(s.fornecedores)}
                    </TableCell>
                    <TableCell>
                      <BarraContencao demanda={demanda} disponivel={disponivel} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        excedente > 0 && 'font-medium text-destructive',
                      )}
                    >
                      {excedente > 0 ? formatarMoeda(excedente) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarMoeda(s.receita_esperada_total)}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.sacado_empresa_id && (
                        <Button variant="ghost" size="icon" asChild>
                          <Link
                            href={`/empresas/${s.sacado_empresa_id}`}
                            aria-label="Abrir Company 360"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {truncado && (
          // A ordenação é feita sobre o que veio. Se a leitura bateu no teto, ordenar
          // por receita mostraria "as maiores receitas das 300 maiores demandas" — um
          // resultado errado com cara de certo. Melhor dizer.
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            Mostrando os {LIMITE_SACADOS} sacados de maior demanda. A ordenação vale sobre esse
            recorte, não sobre a base inteira.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
