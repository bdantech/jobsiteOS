'use client'

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { AcoesReexecucao } from './acoes-execucao'
import { isJobDoWorker } from './constants'
import { formatContador, formatDataHora, formatDuracao, formatMeta } from './format'
import type { Ingestao } from './queries'
import { FonteBadge, StatusBadge } from './status-badge'

/**
 * Everything about one run that does not fit in a table row: the full error text
 * (a Receita download failure is a paragraph, not a cell), the worker's `meta`,
 * and the two re-run buttons.
 */

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm tabular-nums">{children}</p>
    </div>
  )
}

interface Props {
  ingestao: Ingestao | null
  aberto: boolean
  onOpenChange: (aberto: boolean) => void
  podeExecutar: boolean
  fontesEmExecucao: ReadonlySet<string>
  agoraMs: number
}

export function IngestaoDetalheDialog({
  ingestao,
  aberto,
  onOpenChange,
  podeExecutar,
  fontesEmExecucao,
  agoraMs,
}: Props) {
  if (!ingestao) return null

  const meta = formatMeta(ingestao.meta)
  // `fonte` is a text column, so `string` to TS. Narrow it once: null = an
  // importação de lista, which the worker has no job for.
  const fonteJob = isJobDoWorker(ingestao.fonte) ? ingestao.fonte : null
  // "Blocked" only counts runs OTHER than this one — a failed run whose fonte is
  // idle must stay re-runnable.
  const bloqueado = fontesEmExecucao.has(ingestao.fonte) && ingestao.status !== 'executando'

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <FonteBadge fonte={ingestao.fonte} />
            <StatusBadge status={ingestao.status} />
          </DialogTitle>
          <DialogDescription>
            Execução iniciada em {formatDataHora(ingestao.iniciado_em)} — tentativa{' '}
            {ingestao.tentativa}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Campo label="Duração">
            {formatDuracao(ingestao.iniciado_em, ingestao.terminado_em, agoraMs)}
          </Campo>
          <Campo label="Terminado em">
            {ingestao.terminado_em ? formatDataHora(ingestao.terminado_em) : '—'}
          </Campo>
          <Campo label="Tentativa">{ingestao.tentativa}</Campo>
          <Campo label="Linhas processadas">{formatContador(ingestao.linhas_processadas)}</Campo>
          <Campo label="Linhas novas">{formatContador(ingestao.linhas_novas)}</Campo>
          <Campo label="Linhas atualizadas">{formatContador(ingestao.linhas_atualizadas)}</Campo>
        </div>

        {ingestao.erro && (
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Erro
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
              {ingestao.erro}
            </pre>
          </div>
        )}

        {meta && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Metadados do worker
            </p>
            <pre className="max-h-56 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
              {meta}
            </pre>
          </div>
        )}

        {fonteJob !== null && podeExecutar && (
          <>
            <Separator />
            <div className="space-y-3">
              <AcoesReexecucao
                ingestaoId={ingestao.id}
                fonte={fonteJob}
                status={ingestao.status}
                bloqueado={bloqueado}
              />
              <p className="text-xs text-muted-foreground">
                A reexecução usa sempre a fonte primária. O fallback baixa de um espelho não oficial
                e só existe para quando a Receita Federal fica fora do ar — por isso nunca é
                automático.
              </p>
            </div>
          </>
        )}

        {fonteJob === null && (
          <p className="text-xs text-muted-foreground">
            Importações de lista não são reexecutáveis pelo worker — refaça o envio no Importador.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
