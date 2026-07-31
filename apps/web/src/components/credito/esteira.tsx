'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, LayoutGrid, Send, Table2 } from 'lucide-react'
import {
  COLUNAS_ESTEIRA,
  ESTAGIO_ANALISE_LABELS,
  formatCnpj,
  type EstagioAnalise,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { enviarAnalisesAction } from '@/actions/credito'
import { cn } from '@/lib/utils'
import { buscarEsteira, creditoKeys, type AnaliseNaEsteira } from './queries'

/**
 * A esteira (04d §4.4): kanban por estágio, com tabela como alternativa.
 *
 * O kanban NÃO tem arrastar-e-soltar, e a ausência é deliberada: metade dos estágios
 * (enviada, em análise, aprovada, negada, expirada) pertence à seguradora, não a nós.
 * Uma coluna que aceita um card arrastado promete um poder que não existe — e a migração
 * 0073 recusaria a escrita, transformando um gesto natural num erro inexplicável.
 */

const moeda = (v: number | null): string =>
  v === null || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const ESTAGIO_CLASSE: Partial<Record<EstagioAnalise, string>> = {
  aprovada: 'border-emerald-500/40 bg-emerald-500/5',
  aprovada_parcial: 'border-amber-500/40 bg-amber-500/5',
  negada: 'border-destructive/40 bg-destructive/5',
  expirada: 'border-muted-foreground/30 bg-muted/40',
}

function nomeDe(a: AnaliseNaEsteira): string {
  return a.razao_social ?? a.nome_fantasia ?? formatCnpj(a.cnpj)
}

function CartaoAnalise({
  a,
  selecionada,
  onSelecionar,
}: {
  a: AnaliseNaEsteira
  selecionada: boolean
  onSelecionar: ((id: string, v: boolean) => void) | null
}) {
  return (
    <div className={cn('rounded-md border p-2 text-sm', ESTAGIO_CLASSE[a.estagio as EstagioAnalise])}>
      <div className="flex items-start gap-2">
        {onSelecionar && (
          <input
            type="checkbox"
            className="mt-1 h-3.5 w-3.5 shrink-0"
            checked={selecionada}
            onChange={(e) => onSelecionar(a.id, e.target.checked)}
            aria-label={`Selecionar ${nomeDe(a)}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <Link href={`/credito/analises/${a.id}`} className="line-clamp-2 font-medium hover:underline">
            {nomeDe(a)}
          </Link>
          <p className="font-mono text-[11px] tabular-nums text-muted-foreground">{formatCnpj(a.cnpj)}</p>
          <p className="mt-1 text-xs tabular-nums">
            {a.limite_aprovado !== null ? (
              <span className="font-medium">{moeda(a.limite_aprovado)} aprovado</span>
            ) : (
              <span className="text-muted-foreground">{moeda(a.limite_solicitado)} solicitado</span>
            )}
          </p>
          {a.origem === 'atradius_backfill' && (
            // A marca importa: a esteira não pode levar crédito por decisões que ela não
            // tomou, e o funil de conversão ficaria errado se elas entrassem juntas.
            <Badge variant="outline" className="mt-1 text-[10px]">
              da apólice
            </Badge>
          )}
        </div>
      </div>
    </div>
  )
}

export function Esteira() {
  const qc = useQueryClient()
  const [vista, setVista] = React.useState<'kanban' | 'tabela'>('kanban')
  const [selecionadas, setSelecionadas] = React.useState<Set<string>>(new Set())
  const [confirmandoEnvio, setConfirmandoEnvio] = React.useState(false)
  const [enviando, setEnviando] = React.useState(false)

  const { data, isPending, isError, error } = useQuery({
    queryKey: creditoKeys.esteira(),
    queryFn: buscarEsteira,
  })

  const porEstagio = React.useMemo(() => {
    const m = new Map<string, AnaliseNaEsteira[]>()
    for (const a of data ?? []) {
      const lista = m.get(a.estagio) ?? []
      lista.push(a)
      m.set(a.estagio, lista)
    }
    return m
  }, [data])

  function alternar(id: string, v: boolean) {
    setSelecionadas((s) => {
      const n = new Set(s)
      if (v) n.add(id)
      else n.delete(id)
      return n
    })
  }

  async function enviar() {
    setEnviando(true)
    const r = await enviarAnalisesAction([...selecionadas])
    setEnviando(false)
    setConfirmandoEnvio(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (!r.data.enfileirado) {
      toast.error(r.data.aviso ?? 'O worker não aceitou o envio.')
      return
    }
    toast.success('Envio disparado. As decisões chegam pelo poll da seguradora.')
    setSelecionadas(new Set())
    void qc.invalidateQueries({ queryKey: creditoKeys.esteira() })
  }

  if (isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar a esteira.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const solicitadas = porEstagio.get('solicitada') ?? []
  const podeEnviar = selecionadas.size > 0

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Esteira de análise</CardTitle>
              <CardDescription>
                Só os quatro primeiros estágios são nossos. <strong>Enviada em diante é da
                seguradora</strong> — por isso não há arrastar-e-soltar: uma coluna que aceita
                um card promete um poder que não existe.
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!podeEnviar}
                onClick={() => setConfirmandoEnvio(true)}
                title={
                  podeEnviar
                    ? 'Envia as selecionadas à seguradora.'
                    : 'Selecione análises em "Solicitada" para enviar.'
                }
              >
                <Send className="mr-1 h-3.5 w-3.5" aria-hidden />
                Enviar {selecionadas.size > 0 ? `(${selecionadas.size})` : ''}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVista(vista === 'kanban' ? 'tabela' : 'kanban')}
              >
                {vista === 'kanban' ? (
                  <>
                    <Table2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Tabela
                  </>
                ) : (
                  <>
                    <LayoutGrid className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Kanban
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {(data ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nenhuma análise ainda.</p>
              <p className="mt-1">
                As solicitações nascem na Company 360 de um sacado, ou vêm do backfill da apólice.
              </p>
            </div>
          ) : vista === 'kanban' ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {COLUNAS_ESTEIRA.map((estagio) => {
                const itens = porEstagio.get(estagio) ?? []
                const selecionavel = estagio === 'solicitada'
                return (
                  <div key={estagio} className="w-56 shrink-0 space-y-2">
                    <div className="flex items-baseline justify-between gap-2 border-b pb-1">
                      <p className="text-xs font-medium">{ESTAGIO_ANALISE_LABELS[estagio]}</p>
                      <span className="text-xs tabular-nums text-muted-foreground">{itens.length}</span>
                    </div>
                    <div className="space-y-2">
                      {itens.map((a) => (
                        <CartaoAnalise
                          key={a.id}
                          a={a}
                          selecionada={selecionadas.has(a.id)}
                          onSelecionar={selecionavel ? alternar : null}
                        />
                      ))}
                      {itens.length === 0 && (
                        <p className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                          vazio
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Estágio</TableHead>
                    <TableHead className="text-right">Solicitado</TableHead>
                    <TableHead className="text-right">Aprovado</TableHead>
                    <TableHead>Validade</TableHead>
                    <TableHead>Origem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="max-w-[20rem]">
                        <Link href={`/credito/analises/${a.id}`} className="text-sm font-medium hover:underline">
                          {nomeDe(a)}
                        </Link>
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {formatCnpj(a.cnpj)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="whitespace-nowrap text-[11px]">
                          {ESTAGIO_ANALISE_LABELS[a.estagio as EstagioAnalise] ?? a.estagio}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{moeda(a.limite_solicitado)}</TableCell>
                      <TableCell className="text-right tabular-nums">{moeda(a.limite_aprovado)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.expira_em ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.origem === 'atradius_backfill' ? 'apólice' : 'esteira'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/*
       * Diálogo de confirmação, e não um clique direto: o envio resolve o cadastro do
       * buyer na Atradius, e essa consulta PODE SER COBRADA. É a mesma cerimônia que
       * protestos têm, pelo mesmo motivo.
       */}
      <Dialog open={confirmandoEnvio} onOpenChange={setConfirmandoEnvio}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar {selecionadas.size} análise(s) à seguradora</DialogTitle>
            <DialogDescription>
              O envio resolve o cadastro do buyer na Atradius, e <strong>essa consulta pode ser
              cobrada</strong> — uma vez por CNPJ que ainda não tem cadastro. Depois disso o
              pedido de cobertura é submetido e a decisão chega pelo acompanhamento automático.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {solicitadas
              .filter((a) => selecionadas.has(a.id))
              .map((a) => (
                <p key={a.id} className="flex items-baseline justify-between gap-2">
                  <span className="truncate">{nomeDe(a)}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {moeda(a.limite_solicitado)}
                  </span>
                </p>
              ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmandoEnvio(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void enviar()} disabled={enviando}>
              {enviando ? 'Enviando…' : 'Confirmar envio'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
