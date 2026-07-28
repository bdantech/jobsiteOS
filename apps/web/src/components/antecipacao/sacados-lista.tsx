'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { creditoBadge, formatarInteiro, formatarMoeda, labelCredito } from './format'
import { antecipacaoKeys, buscarSacados } from './queries'

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

export function SacadosLista() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.sacados(),
    queryFn: buscarSacados,
  })

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

  const estourando = data.filter((s) => Number(s.demanda_pipeline ?? 0) > Number(s.available_limit ?? 0))

  return (
    <Card>
      <CardHeader>
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
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sacado</TableHead>
                <TableHead>Crédito</TableHead>
                <TableHead className="text-right">Notas</TableHead>
                <TableHead className="text-right">Fornecedores</TableHead>
                <TableHead>Demanda vs. limite</TableHead>
                <TableHead className="text-right">Excedente</TableHead>
                <TableHead className="text-right">Receita esperada</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                    Nenhuma nota em faixa ainda — não há demanda de pipeline para comparar.
                  </TableCell>
                </TableRow>
              )}

              {data.map((s) => {
                const demanda = Number(s.demanda_pipeline ?? 0)
                const disponivel = Number(s.available_limit ?? 0)
                const excedente = Math.max(0, demanda - disponivel)

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
      </CardContent>
    </Card>
  )
}
