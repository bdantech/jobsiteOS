'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Megaphone, Plus } from 'lucide-react'
import {
  PRESETS,
  STATUS_CAMPANHA_LABELS,
  TIPO_CAMPANHA_LABELS,
  type StatusCampanha,
  type TipoCampanha,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { buscarCampanhas, campanhasKeys } from './queries'

/**
 * A lista, e os presets em destaque na criação (§8).
 *
 * Os atalhos ficam ACIMA da tabela de propósito: a campanha que alguém consegue
 * descrever em uma frase ("reconquista de quem saiu por taxa") é a que costuma
 * dar certo, e obrigá-la a passar pelo construtor em branco é o caminho mais
 * curto para ninguém criar campanha nenhuma.
 */

const TOM_STATUS: Record<StatusCampanha, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  rascunho: 'outline',
  aguardando_aprovacao: 'secondary',
  agendada: 'default',
  executando: 'default',
  pausada: 'secondary',
  concluida: 'outline',
  cancelada: 'destructive',
}

function taxa(respondidas: number, enviadas: number): string {
  if (enviadas <= 0) return '—'
  return `${((respondidas / enviadas) * 100).toFixed(1)}%`
}

export function CampanhasLista({ podeGerir }: { podeGerir: boolean }) {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: campanhasKeys.lista(),
    queryFn: buscarCampanhas,
    // O painel de uma campanha executando muda sozinho: o executor enfileira a
    // cada 15 minutos e o envio drena continuamente.
    refetchInterval: 60_000,
  })

  const campanhas = data ?? []

  return (
    <div className="space-y-6">
      {podeGerir && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Começar por um atalho</CardTitle>
            <CardDescription>
              Todos são editáveis depois. O atalho monta o público; o resto do caminho é o mesmo.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {PRESETS.map((p) => (
              <Link
                key={p.id}
                href={`/comercial/campanhas/nova?preset=${p.id}`}
                className="rounded-lg border p-3 transition-colors hover:border-primary hover:bg-accent/40"
              >
                <p className="text-sm font-medium">{p.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{p.descricao}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4" aria-hidden />
              Campanhas
            </CardTitle>
            <CardDescription>
              Uma campanha vira conversa do Agente assim que alguém responde.
            </CardDescription>
          </div>
          {podeGerir && (
            <Button asChild>
              <Link href="/comercial/campanhas/nova">
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Nova campanha
              </Link>
            </Button>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {isPending ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'Erro ao carregar as campanhas.'}
              </p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campanha</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Público</TableHead>
                    <TableHead className="text-right">Enviadas</TableHead>
                    <TableHead className="text-right">Respostas</TableHead>
                    <TableHead className="text-right">Taxa</TableHead>
                    <TableHead>Dono</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campanhas.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                        Nenhuma campanha ainda.
                      </TableCell>
                    </TableRow>
                  )}
                  {campanhas.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link
                          href={`/comercial/campanhas/${c.id}`}
                          className="font-medium hover:underline"
                        >
                          {c.nome}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {TIPO_CAMPANHA_LABELS[c.tipo as TipoCampanha] ?? c.tipo} ·{' '}
                          {c.canal === 'email' ? 'E-mail' : 'WhatsApp'}
                          {c.segmento_nome ? ` · ${c.segmento_nome}` : ''}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={TOM_STATUS[c.status as StatusCampanha] ?? 'outline'}>
                          {STATUS_CAMPANHA_LABELS[c.status as StatusCampanha] ?? c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.total ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.enviadas ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.respondidas ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {taxa(c.respondidas ?? 0, c.enviadas ?? 0)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.vendedor_nome ?? 'Casa / IA'}
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
