'use client'

import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarClock } from 'lucide-react'
import { TIPO_PRAZO_LABELS, type TipoPrazo } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { concluirPrazoAction } from '@/actions/juridico'
import { buscarAgendaJuridica, juridicoKeys } from './queries'
import { dataHora } from './format'

/**
 * A agenda jurídica agrupada por dia (08 §9).
 *
 * ── OS ATRASADOS FICAM NO TOPO, E EM VERMELHO ──────────────────────────────
 * A janela começa sete dias atrás. Um prazo de ontem que ninguém marcou como
 * concluído é exatamente o que precisa aparecer primeiro — escondê-lo por já ter
 * passado é transformar um problema em silêncio.
 */

function diaLegivel(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  })
}

export function PrazosAgenda() {
  const qc = useQueryClient()
  const agenda = useQuery({ queryKey: juridicoKeys.agenda(), queryFn: buscarAgendaJuridica })

  if (agenda.isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    )
  }

  const linhas = agenda.data ?? []
  const agora = Date.now()

  const porDia = new Map<string, typeof linhas>()
  for (const e of linhas) {
    if (!e.inicio_em) continue
    const chave = e.inicio_em.slice(0, 10)
    porDia.set(chave, [...(porDia.get(chave) ?? []), e])
  }

  if (linhas.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <CalendarClock className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Nenhum prazo ou audiência em aberto. Os prazos são cadastrados na tela de cada processo e
            avisam o responsável em D-3 e D-1.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {[...porDia.entries()].map(([dia, eventos]) => (
        <div key={dia}>
          <h2 className="mb-2 text-sm font-medium capitalize">{diaLegivel(`${dia}T12:00:00`)}</h2>
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {eventos.map((e) => {
                const atrasado = e.inicio_em ? Date.parse(e.inicio_em) < agora : false
                return (
                  <div key={e.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={atrasado ? 'destructive' : 'outline'}>
                          {TIPO_PRAZO_LABELS[e.tipo as TipoPrazo] ?? e.tipo}
                        </Badge>
                        <span className="truncate text-sm">{e.titulo}</span>
                        {atrasado ? <Badge variant="destructive">vencido</Badge> : null}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {dataHora(e.inicio_em)} ·{' '}
                        <Link href={`/juridico/${e.numero_cnj}`} className="font-mono hover:underline">
                          {e.numero_cnj}
                        </Link>
                        {e.devedor_nome ? ` · ${e.devedor_nome}` : ''}
                        {e.responsavel_nome ? ` · ${e.responsavel_nome}` : ' · sem responsável'}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        if (!e.id) return
                        const r = await concluirPrazoAction(e.id, true)
                        if (!r.ok) {
                          toast.error(r.message)
                          return
                        }
                        void qc.invalidateQueries({ queryKey: juridicoKeys.agenda() })
                        toast.success('Prazo concluído.')
                      }}
                    >
                      Concluir
                    </Button>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  )
}
