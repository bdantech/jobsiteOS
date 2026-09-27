'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import {
  CAUSA_SINISTRO_LABELS,
  SINISTRO_ESTAGIOS,
  diasEntreDatas,
  hojeSaoPaulo,
  type CausaSinistro,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { buscarSinistros, gestaoKeys } from './gestao-queries'
import { NovoSinistroDialog } from './sinistro-novo'
import { brl, cnpj, corDoPrazo, data, prazoTexto, sinistroEstagioLabel } from './format'

/**
 * Lista de sinistros (§7). A coluna que manda é o PRAZO DE ENVIO: 6 meses da Data da
 * Perda (cl. 22100.20 §1). Depois de enviado, ele deixa de ser o relógio — quem corre
 * aí é a seguradora, com a resposta prevista em 120 dias.
 */

/** Dias de hoje (em SP) até `iso`. Negativo = passou. */
export function diasAte(iso: string | null | undefined): number | null {
  if (!iso) return null
  return diasEntreDatas(hojeSaoPaulo(), iso.slice(0, 10))
}

export const causaLabel = (c: string | null | undefined) =>
  c ? (CAUSA_SINISTRO_LABELS[c as CausaSinistro] ?? c) : '—'

const ENCERRADOS = new Set(['indenizado', 'encerrado', 'recusado'])

export function SinistrosLista() {
  const q = useQuery({ queryKey: gestaoKeys.sinistros(), queryFn: buscarSinistros })
  const [estagio, setEstagio] = React.useState<string>('ativos')
  const [novo, setNovo] = React.useState(false)

  const linhas = (q.data ?? []).filter((s) =>
    estagio === 'todos' ? true : estagio === 'ativos' ? !ENCERRADOS.has(s.estagio) : s.estagio === estagio,
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={estagio} onValueChange={setEstagio}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ativos">Em andamento</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
            {SINISTRO_ESTAGIOS.map((e) => (
              <SelectItem key={e} value={e}>
                {sinistroEstagioLabel(e)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => setNovo(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Novo sinistro
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {q.isLoading ? (
            <Skeleton className="m-4 h-40" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Sacado</TableHead>
                  <TableHead>Causa</TableHead>
                  <TableHead>Estágio</TableHead>
                  <TableHead>Data da perda</TableHead>
                  <TableHead>Prazo de envio</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Indenização est.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((s) => {
                  const correndo = s.estagio === 'preparacao' || s.estagio === 'notificado'
                  const dias = correndo ? diasAte(s.data_limite_envio) : null
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link href={`/cobranca/sinistros/${s.id}`} className="font-medium text-primary hover:underline">
                          {s.codigo ?? 'Sinistro'}
                        </Link>
                        {s.cobranca_codigo ? (
                          <div className="text-[11px] text-muted-foreground">{s.cobranca_codigo}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div>{s.sacado_razao_social ?? '—'}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{cnpj(s.sacado_matriz_cnpj)}</div>
                      </TableCell>
                      <TableCell>{causaLabel(s.causa)}</TableCell>
                      <TableCell>{sinistroEstagioLabel(s.estagio)}</TableCell>
                      <TableCell>{data(s.data_perda)}</TableCell>
                      <TableCell>
                        <div>{data(s.data_limite_envio)}</div>
                        {correndo ? (
                          <div className={cn('text-xs tabular-nums', corDoPrazo(dias))}>{prazoTexto(dias)}</div>
                        ) : s.enviado_em ? (
                          <div className="text-xs text-muted-foreground">enviado em {data(s.enviado_em)}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{brl(s.valor_total_face)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(s.indenizacao_estimada)}</TableCell>
                    </TableRow>
                  )
                })}
                {linhas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      Nenhum sinistro {estagio === 'ativos' ? 'em andamento' : 'neste filtro'}.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NovoSinistroDialog aberto={novo} onFechar={() => setNovo(false)} />
    </div>
  )
}
