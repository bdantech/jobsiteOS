'use client'

import * as React from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Ban, RotateCcw, Search } from 'lucide-react'
import {
  MOTIVOS_SEM_INTERESSE,
  MOTIVO_SEM_INTERESSE_LABELS,
  type MotivoSemInteresse,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { moverFornecedorAction } from '@/actions/fornecedores'
import { buscarFunil, fornecedoresKeys } from './queries'
import { brl, cnpjFormatado, dia } from './formato'

/**
 * Os fornecedores que saíram do funil de cadastro — quem já foi trabalhado e não vai se
 * cadastrar, com o motivo.
 *
 * A tela existe pela mesma razão da irmã na Antecipação: o descarte precisa ser uma
 * DECISÃO REGISTRADA e não um desaparecimento. Sem ela, "sumiu do kanban" e "nunca
 * esteve no kanban" seriam indistinguíveis, e conferir um descarte exigiria abrir o
 * banco.
 *
 * ─── O QUE ESTA TEM E A DA ANTECIPAÇÃO NÃO ───────────────────────────────────
 *
 * A DATA DE VOLTA. Aqui o descarte tem validade: 90 dias por padrão, e o job noturno
 * devolve o card ao funil quando ela vence. "Sem interesse hoje" e "nunca mais" são
 * decisões diferentes, e a coluna diz qual foi tomada — sem ela, a supressão soft
 * pareceria eterna e ninguém saberia quando voltar a ligar.
 *
 * Reverter aqui desfaz as TRÊS marcações na mesma transação: a supressão de canal (só
 * a de contexto `comercial`, para não liberar um CNPJ que outro time bloqueou), a
 * qualificação que a lista da Antecipação lê, e o estágio. Um desfazer que desfaz
 * metade — deixando o card de volta e o CNPJ suprimido — é pior que nenhum.
 */
export function FornecedoresSemInteresse() {
  const qc = useQueryClient()
  const [termo, setTermo] = React.useState('')
  const [motivoFiltro, setMotivoFiltro] = React.useState<MotivoSemInteresse | 'todos'>('todos')

  const lista = useQuery({
    queryKey: fornecedoresKeys.funil('sem-interesse'),
    queryFn: () => buscarFunil({ originadorId: null, incluir: 'so_sem_interesse', termo: '' }),
  })

  const reabrir = useMutation({
    mutationFn: async (cnpj: string) => {
      const r = await moverFornecedorAction({ fornecedor_cnpj: cnpj, estagio: 'a_cadastrar' })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success('De volta ao funil. A supressão do canal foi desfeita junto.')
      void qc.invalidateQueries({ queryKey: fornecedoresKeys.todos })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const linhas = React.useMemo(() => {
    const t = termo.trim().toLowerCase()
    const digitos = t.replace(/\D/g, '')
    return (lista.data ?? [])
      .filter((f) => motivoFiltro === 'todos' || f.sem_interesse_motivo === motivoFiltro)
      .filter((f) => {
        if (!t) return true
        // Mesma regra de busca da lista a prospectar: CNPJ por dígitos (quem cola
        // "66.872.185/0001-32" não deveria ter de apagar a pontuação) ou nome.
        if (digitos.length >= 4) return f.fornecedor_cnpj.includes(digitos)
        return (f.fornecedor_nome ?? '').toLowerCase().includes(t)
      })
  }, [lista.data, termo, motivoFiltro])

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/comercial/fornecedores">
          <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden />
          Voltar ao funil
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Ban className="h-4 w-4 text-muted-foreground" aria-hidden />
              <CardTitle className="text-base">Sem interesse em se cadastrar</CardTitle>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  placeholder="Nome ou CNPJ…"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  className="h-9 w-48 pl-7"
                />
              </div>
              <Select
                value={motivoFiltro}
                onValueChange={(v) => setMotivoFiltro(v as MotivoSemInteresse | 'todos')}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os motivos</SelectItem>
                  {MOTIVOS_SEM_INTERESSE.map((m) => (
                    <SelectItem key={m} value={m}>{MOTIVO_SEM_INTERESSE_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <CardDescription>
            Marcar sem interesse <strong>suprime o CNPJ em todos os canais</strong>, não só
            aqui — ele também sai da lista a prospectar da Antecipação e para de gerar
            mensagem na outbox. Por padrão a supressão vale <strong>90 dias</strong> e o job
            noturno devolve o card ao funil quando ela vence; sem data, é definitiva.
            {linhas.length > 0 ? ` ${linhas.length} fornecedor(es).` : ''}
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          {lista.isPending ? (
            <div className="p-4">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : linhas.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nenhum descarte registrado.</p>
              <p className="mt-1">
                Quem for marcado como sem interesse no funil aparece aqui, com o motivo e a
                data em que volta.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Observação</TableHead>
                    <TableHead className="text-right">Volume 90d</TableHead>
                    <TableHead>Volta em</TableHead>
                    <TableHead>Marcado em</TableHead>
                    <TableHead className="text-right">Reabrir</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((f) => (
                    <TableRow key={f.fornecedor_cnpj}>
                      <TableCell>
                        <p className="font-medium">{f.fornecedor_nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {cnpjFormatado(f.fornecedor_cnpj)}
                          {f.municipio ? ` · ${f.municipio}/${f.uf ?? ''}` : ''}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs">
                        {f.sem_interesse_motivo
                          ? (MOTIVO_SEM_INTERESSE_LABELS[
                              f.sem_interesse_motivo as MotivoSemInteresse
                            ] ?? f.sem_interesse_motivo)
                          : '—'}
                      </TableCell>
                      <TableCell className="max-w-64 text-xs text-muted-foreground">
                        {f.sem_interesse_observacao ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{brl(f.volume_90d)}</TableCell>
                      <TableCell>
                        {/*
                          Sem data é DEFINITIVO, e o badge diz isso em vez de deixar um
                          traço — um "—" nesta coluna leria como "não sei", quando a
                          ausência de data é justamente a informação.
                        */}
                        {f.sem_interesse_ate ? (
                          <span className="text-xs tabular-nums">{dia(f.sem_interesse_ate)}</span>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">definitivo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        {dia(f.estagio_alterado_em)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={reabrir.isPending}
                          onClick={() => reabrir.mutate(f.fornecedor_cnpj)}
                          title="Devolve ao funil e desfaz a supressão de canal na mesma transação"
                        >
                          <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />
                          Reabrir
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
