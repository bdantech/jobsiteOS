'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Ban, ExternalLink, RotateCcw, Search } from 'lucide-react'
import {
  MOTIVOS_SEM_INTERESSE,
  MOTIVO_SEM_INTERESSE_LABELS,
  formatCnpj,
  type MotivoSemInteresse,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { reverterFornecedorSemInteresseAction } from '@/actions/antecipacao'
import { formatarData, formatarInteiro, formatarMoeda } from './format'
import {
  antecipacaoKeys,
  buscarFornecedoresSemInteresse,
  type FornecedorSemInteresse,
} from './queries'

/**
 * Os fornecedores que saíram da lista a prospectar — quem já foi trabalhado e não
 * vai se cadastrar, com o motivo.
 *
 * A tela existe para que o descarte seja uma DECISÃO REGISTRADA e não um
 * desaparecimento. Sem ela, "sumiu da lista" e "nunca esteve na lista" seriam
 * indistinguíveis, e a única forma de conferir um descarte seria abrir o banco.
 *
 * É também onde o descarte se desfaz: quem atendeu o telefone pode não ser quem
 * decide, e o "não" de hoje é o "me liga em março" de amanhã. Reverter devolve o
 * fornecedor à lista e as notas dele aos funis, sem apagar nada — a marcação some,
 * o audit_log fica.
 */
export function FornecedoresSemInteresse() {
  const qc = useQueryClient()
  const [termo, setTermo] = React.useState('')
  const [motivoFiltro, setMotivoFiltro] = React.useState<MotivoSemInteresse | 'todos'>('todos')
  const [revertendo, setRevertendo] = React.useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.fornecedoresSemInteresse(),
    queryFn: buscarFornecedoresSemInteresse,
  })

  const linhas = React.useMemo(() => {
    if (!data) return []
    const t = termo.trim().toLowerCase()
    const digitos = t.replace(/\D/g, '')
    return data.filter((f) => {
      if (motivoFiltro !== 'todos' && f.motivo !== motivoFiltro) return false
      if (!t) return true
      // Mesma regra de busca da lista a prospectar: CNPJ por dígitos (quem cola
      // "66.872.185/0001-32" não deveria ter de apagar a pontuação) ou nome.
      if (digitos.length >= 3 && (f.fornecedor_cnpj ?? '').includes(digitos)) return true
      return (f.fornecedor_nome ?? '').toLowerCase().includes(t)
    })
  }, [data, termo, motivoFiltro])

  async function reverter(f: FornecedorSemInteresse) {
    if (!f.fornecedor_cnpj) return
    setRevertendo(f.fornecedor_cnpj)
    const r = await reverterFornecedorSemInteresseAction({ cnpj: f.fornecedor_cnpj })
    setRevertendo(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('De volta à lista a prospectar — as notas dele voltam aos funis.')
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
  }

  if (isPending) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          {Array.from({ length: 5 }).map((_, i) => (
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
            {error instanceof Error ? error.message : 'Erro ao carregar.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Quantos por motivo — a única leitura agregada que esta tela precisa dar. É o que
  // transforma uma lista de descartes numa resposta: "perdemos 40 para quem já opera
  // com outro" é insumo de argumentário, não de faxina de lista.
  const porMotivo = new Map<string, number>()
  for (const f of data) if (f.motivo) porMotivo.set(f.motivo, (porMotivo.get(f.motivo) ?? 0) + 1)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Ban className="h-4 w-4 text-muted-foreground" aria-hidden />
              <CardTitle className="text-base">Sem interesse em se cadastrar</CardTitle>
            </div>
            <Button variant="outline" size="sm" asChild className="shrink-0">
              <Link href="/antecipacao/prospectar-fornecedores">
                <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden />
                Fornecedores a prospectar
              </Link>
            </Button>
          </div>
          <CardDescription>
            Fornecedores já trabalhados que <strong>não vão se cadastrar</strong>. Eles saem da
            lista a prospectar e as notas deles saem dos funis. Não é supressão de contato — é o
            registro de que a ligação já foi feita, e reverter devolve tudo.
            {data.length > 0 ? (
              <>
                {' '}
                {formatarInteiro(data.length)} fornecedor{data.length > 1 ? 'es' : ''} descartado
                {data.length > 1 ? 's' : ''}.
              </>
            ) : null}
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-3 border-y border-border p-3">
            <div className="relative min-w-64 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Buscar por nome ou CNPJ"
                className="pl-9"
                aria-label="Buscar fornecedores sem interesse"
              />
            </div>
            <span className="shrink-0 text-sm text-muted-foreground">
              {termo.trim() || motivoFiltro !== 'todos'
                ? `${formatarInteiro(linhas.length)} de ${formatarInteiro(data.length)}`
                : `${formatarInteiro(data.length)} fornecedor(es)`}
            </span>
          </div>

          {/*
           * Os motivos como FILTRO e como contagem ao mesmo tempo: um chip que só
           * contasse obrigaria a ler o número e depois procurar as linhas à mão.
           * Só aparecem os motivos que existem na lista — botões zerados são ruído.
           */}
          {data.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-b border-border p-3">
              <Button
                variant={motivoFiltro === 'todos' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMotivoFiltro('todos')}
              >
                Todos · {formatarInteiro(data.length)}
              </Button>
              {MOTIVOS_SEM_INTERESSE.filter((m) => porMotivo.has(m)).map((m) => (
                <Button
                  key={m}
                  variant={motivoFiltro === m ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMotivoFiltro(m)}
                >
                  {MOTIVO_SEM_INTERESSE_LABELS[m]} · {formatarInteiro(porMotivo.get(m) ?? 0)}
                </Button>
              ))}
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="text-right" title="Notas emitidas nos últimos 90 dias.">
                    Notas
                  </TableHead>
                  <TableHead className="text-right">Valor emitido</TableHead>
                  <TableHead>Marcado em</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                      {termo.trim() || motivoFiltro !== 'todos' ? (
                        <>Nenhum fornecedor com esse filtro.</>
                      ) : (
                        <>
                          Ninguém foi descartado ainda. O botão de marcar fica na lista de
                          fornecedores a prospectar, e na ficha de cada fornecedor.
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                )}

                {linhas.map((f) => (
                  <TableRow key={f.fornecedor_cnpj}>
                    <TableCell className="max-w-[20rem]">
                      <Link
                        href={`/antecipacao/fornecedores/${f.fornecedor_cnpj}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {f.fornecedor_nome ?? '—'}
                      </Link>
                      <p className="font-mono text-xs tabular-nums text-muted-foreground">
                        {f.fornecedor_cnpj ? formatCnpj(f.fornecedor_cnpj) : '—'}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-[22rem]">
                      <Badge variant="outline">
                        {MOTIVO_SEM_INTERESSE_LABELS[f.motivo as MotivoSemInteresse] ??
                          f.motivo ??
                          '—'}
                      </Badge>
                      {/*
                       * A observação abaixo do motivo, e não numa coluna própria: ela é
                       * o detalhe do motivo, e quase sempre está vazia — uma coluna só
                       * para ela seria um corredor de travessões.
                       */}
                      {f.observacao ? (
                        <p className="mt-1 text-xs text-muted-foreground">{f.observacao}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarInteiro(f.notas)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarMoeda(f.valor_agregado)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatarData(f.marcado_em)}
                      {f.marcado_por_nome ? (
                        <span className="block text-xs">por {f.marcado_por_nome}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {f.fornecedor_empresa_id ? (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/empresas/${f.fornecedor_empresa_id}`}>
                              <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                              Ficha
                            </Link>
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={revertendo === f.fornecedor_cnpj}
                          onClick={() => void reverter(f)}
                        >
                          <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />
                          {revertendo === f.fornecedor_cnpj ? 'Voltando…' : 'Reverter'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {data.length >= 1000 && (
            // O teto do PostgREST corta em 1.000 sem erro nenhum (foi assim que a lista
            // a prospectar perdeu 800 linhas em silêncio). Aqui ele está longe, mas
            // quando chegar o aviso vem antes da conclusão errada.
            <p className="border-t px-4 py-3 text-xs text-muted-foreground">
              A lista bateu em 1.000 descartados, que é o teto de uma leitura só. Vale paginar
              esta tela.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
