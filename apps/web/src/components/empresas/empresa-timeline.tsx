'use client'

import type { ComponentType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRightLeft, Building2, History, MessageSquare } from 'lucide-react'
import { EVENTO_LABELS } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDataHora, formatRelativo } from './format'
import { buscarEventos, empresasKeys } from './queries'

/** Icon per event type. An unregistered type still renders — with a neutral icon. */
const ICONES: Record<string, ComponentType<{ className?: string }>> = {
  'empresa.criada': Building2,
  'estagio.alterado': ArrowRightLeft,
  'nota.criada': MessageSquare,
}

function TimelineCarregando() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmpresaTimeline({ empresaId }: { empresaId: string }) {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: empresasKeys.eventos(empresaId),
    queryFn: () => buscarEventos(empresaId),
  })

  const eventos = data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linha do tempo</CardTitle>
        <CardDescription>Tudo que aconteceu com esta empresa, do mais recente.</CardDescription>
      </CardHeader>

      <CardContent>
        {isPending ? (
          <TimelineCarregando />
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">Não foi possível carregar a linha do tempo</p>
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'Erro desconhecido.'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : eventos.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="rounded-full bg-muted p-3">
              <History className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-sm text-muted-foreground">Nenhum evento registrado.</p>
          </div>
        ) : (
          <ol className="relative space-y-6">
            {/* The rail is decorative: it stops at the last dot, not at the
                bottom of the card, so it never dangles under the last event. */}
            <span
              className="absolute bottom-3 left-[13px] top-3 w-px bg-border"
              aria-hidden
            />
            {eventos.map((evento) => {
              const Icone = ICONES[evento.tipo] ?? History
              // EVENTO_LABELS is Record<string, string> on purpose: a module we
              // haven't written yet can emit a type this build has never seen.
              const label = EVENTO_LABELS[evento.tipo] ?? evento.tipo
              const ator = evento.ator_nome ?? 'Sistema'

              return (
                <li key={evento.id} className="relative flex gap-3">
                  <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background">
                    <Icone className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1 pt-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium">{label}</span>
                      <time
                        dateTime={evento.criado_em}
                        title={formatDataHora(evento.criado_em)}
                        className="text-xs text-muted-foreground"
                      >
                        {formatRelativo(evento.criado_em)}
                      </time>
                    </div>
                    {evento.resumo && (
                      <p className="break-words text-sm text-muted-foreground">{evento.resumo}</p>
                    )}
                    <p className="text-xs text-muted-foreground">por {ator}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
