'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  STATUS_REPORT_DESCRICOES,
  STATUS_REPORT_LABELS,
  type StatusReport,
} from '@jobsiteos/core'
import { comentarReportAction } from '@/actions/reports'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ContextoTecnico } from './contexto-tecnico'
import { Numero, PrioridadeBadge, StatusBadge, TipoIcone } from './badges'
import { buscarComentarios, buscarHistorico, reportsKeys } from './queries'

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

interface ReportMinimo {
  id: string
  numero: number
  tipo: string
  titulo: string
  descricao: string
  status: string
  prioridade: string | null
  contexto: unknown
  anexo_url: string | null
  criado_em: string
}

/**
 * A página de UM report, vista por quem o escreveu.
 *
 * O que ela mostra e o que não mostra é a mesma linha que a RLS traça: os
 * comentários chegam já sem os internos (a policy não entrega a linha), e não há
 * nada aqui para "esconder no cliente". A tela não decide; ela desenha o que o
 * banco entregou.
 */
export function ReportPagina({ report, ehAutor }: { report: ReportMinimo; ehAutor: boolean }) {
  const comentarios = useQuery({
    queryKey: reportsKeys.comentarios(report.id),
    queryFn: () => buscarComentarios(report.id),
  })
  const historico = useQuery({
    queryKey: reportsKeys.historico(report.id),
    queryFn: () => buscarHistorico(report.id),
  })

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <TipoIcone tipo={report.tipo} />
            <Numero numero={report.numero} />
            <span className="min-w-0">{report.titulo}</span>
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <StatusBadge status={report.status} />
            <PrioridadeBadge prioridade={report.prioridade} />
            <span>{dataHora.format(new Date(report.criado_em))}</span>
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* O que o status quer dizer, e não só o rótulo. "Não procede" sem
              explicação lê-se como desprezo; com a frase, lê-se como resposta. */}
          <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            {STATUS_REPORT_DESCRICOES[report.status as StatusReport] ?? ''}
          </p>

          <p className="whitespace-pre-wrap text-sm">{report.descricao}</p>

          <ContextoTecnico contexto={report.contexto as never} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Andamento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {historico.isPending ? (
            <Skeleton className="h-12 w-full" />
          ) : (
            <ol className="space-y-1 text-xs text-muted-foreground">
              {(historico.data ?? []).map((h) => (
                <li key={h.id}>
                  <span className="tabular-nums">{dataHora.format(new Date(h.alterado_em))}</span> ·{' '}
                  <strong className="text-foreground">
                    {STATUS_REPORT_LABELS[h.status_novo as StatusReport] ?? h.status_novo}
                  </strong>
                </li>
              ))}
            </ol>
          )}

          {comentarios.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (comentarios.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Ainda sem comentários.</p>
          ) : (
            <ul className="space-y-2">
              {(comentarios.data ?? []).map((c) => (
                <li key={c.id} className="rounded-md bg-muted/40 p-2 text-sm">
                  <p className="text-xs text-muted-foreground">
                    {c.autor_nome ?? 'Equipe'} · {dataHora.format(new Date(c.criado_em))}
                  </p>
                  <p className="whitespace-pre-wrap">{c.texto}</p>
                </li>
              ))}
            </ul>
          )}

          {ehAutor && <Responder reportId={report.id} />}
        </CardContent>
      </Card>
    </div>
  )
}

function Responder({ reportId }: { reportId: string }) {
  const qc = useQueryClient()
  const [texto, setTexto] = React.useState('')

  const enviar = useMutation({
    mutationFn: async () => {
      const r = await comentarReportAction({ report_id: reportId, texto })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      setTexto('')
      void qc.invalidateQueries({ queryKey: reportsKeys.comentarios(reportId) })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível comentar.'),
  })

  return (
    <div className="space-y-2">
      <Textarea
        value={texto}
        rows={3}
        maxLength={5000}
        placeholder="Responder…"
        onChange={(e) => setTexto(e.target.value)}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!texto.trim() || enviar.isPending}
          onClick={() => enviar.mutate()}
        >
          Enviar
        </Button>
      </div>
    </div>
  )
}
