'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, LifeBuoy, Loader2, Play, RotateCw } from 'lucide-react'
import { FONTE_INGESTAO_LABELS } from '@jobsiteos/core'
import { dispararIngestaoAction } from '@/actions/mercado-worker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ingestoesKeys } from './queries'
import { JOBS_DO_WORKER, type JobDoWorker } from './constants'

/**
 * Every button that talks to the worker.
 *
 * The disabled states below are a courtesy, not a control: the server action
 * re-checks admin, "fallback only after a failure" and "one run per fonte" against
 * the database on every call. Nothing here is trusted.
 */

function useDisparar() {
  const queryClient = useQueryClient()
  const [pendente, setPendente] = React.useState(false)

  const disparar = React.useCallback(
    async (input: { fonte: JobDoWorker; fallback: boolean; reexecucao_de?: string }) => {
      setPendente(true)
      try {
        const resultado = await dispararIngestaoAction(input)

        if (!resultado.ok) {
          toast.error(resultado.message)
          return false
        }

        toast.success(resultado.message, {
          description: 'O worker atualiza o progresso aqui a cada poucos segundos.',
        })
        // The run row only appears once the worker has written it. Refetch now,
        // and the 5s poll takes over from there.
        await queryClient.invalidateQueries({ queryKey: ingestoesKeys.all })
        return true
      } catch (error) {
        console.error('[mercado] falha ao disparar a ingestão', error)
        toast.error('Não foi possível disparar a execução.')
        return false
      } finally {
        setPendente(false)
      }
    },
    [queryClient],
  )

  return { disparar, pendente }
}

// ─── Executar agora (cabeçalho) ─────────────────────────────────────────────

/**
 * Manual trigger outside of any existing run: the first ingestion ever, or a
 * re-run of a month that completed. Fontes already executing are disabled here —
 * a second Receita job would fight the first one for the staging tables.
 */
export function ExecutarAgora({
  fontesBloqueadas,
}: {
  fontesBloqueadas: ReadonlySet<string>
}) {
  const { disparar, pendente } = useDisparar()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={pendente}>
          {pendente ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Play className="mr-2 h-4 w-4" aria-hidden />
          )}
          Executar agora
          <ChevronDown className="ml-2 h-4 w-4 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {JOBS_DO_WORKER.map((fonte) => {
          const bloqueada = fontesBloqueadas.has(fonte)
          return (
            <DropdownMenuItem
              key={fonte}
              disabled={bloqueada}
              onSelect={() => {
                void disparar({ fonte, fallback: false })
              }}
            >
              <div className="flex flex-col">
                <span>{FONTE_INGESTAO_LABELS[fonte]}</span>
                {bloqueada && (
                  <span className="text-xs text-muted-foreground">Já está em execução</span>
                )}
              </div>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Reexecutar / Reexecutar com fallback (linha e detalhe) ─────────────────

interface AcoesReexecucaoProps {
  ingestaoId: string
  /** Already narrowed by the caller: `lista` runs have no worker job. */
  fonte: JobDoWorker
  status: string
  /** Another run of the same fonte is in flight. */
  bloqueado: boolean
  compacto?: boolean
}

export function AcoesReexecucao({
  ingestaoId,
  fonte,
  status,
  bloqueado,
  compacto = false,
}: AcoesReexecucaoProps) {
  const { disparar, pendente } = useDisparar()
  const [confirmando, setConfirmando] = React.useState(false)

  const falhou = status === 'falhou'
  const executando = status === 'executando'
  // Nothing to re-run while it is still running, and never two at once.
  const desabilitado = pendente || bloqueado || executando

  const motivoFallback = falhou
    ? 'Baixa da fonte espelho em vez da Receita Federal.'
    : 'Disponível apenas após uma execução que falhou.'

  const tamanho = compacto ? 'sm' : 'default'

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size={tamanho}
          disabled={desabilitado}
          title={
            executando
              ? 'A execução ainda está em andamento.'
              : bloqueado
                ? 'Já existe uma execução em andamento para esta fonte.'
                : 'Executa de novo a partir da fonte primária (Receita Federal).'
          }
          onClick={() => {
            void disparar({ fonte, fallback: false, reexecucao_de: ingestaoId })
          }}
        >
          {pendente ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RotateCw className="mr-2 h-4 w-4" aria-hidden />
          )}
          Reexecutar
        </Button>

        <Button
          variant="outline"
          size={tamanho}
          disabled={desabilitado || !falhou}
          title={motivoFallback}
          onClick={() => setConfirmando(true)}
        >
          <LifeBuoy className="mr-2 h-4 w-4" aria-hidden />
          Reexecutar com fallback
        </Button>
      </div>

      {/*
        The fallback is a mirror maintained by a third party, so it is never
        automatic (spec §3.1) and never one click away: an admin must read what
        they are choosing before the data provenance changes.
      */}
      <Dialog open={confirmando} onOpenChange={setConfirmando}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reexecutar com fallback?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-1 text-left">
                <p>
                  Esta execução vai baixar os dados de um <strong>espelho não oficial</strong> em vez
                  do servidor da Receita Federal. Use apenas quando a fonte primária estiver fora do
                  ar depois de todas as tentativas.
                </p>
                <p>
                  Os dados carregados ficam marcados com a origem do espelho em{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">meta</code>, para você saber
                  depois de onde vieram.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmando(false)} disabled={pendente}>
              Cancelar
            </Button>
            <Button
              disabled={pendente}
              onClick={() => {
                void disparar({ fonte, fallback: true, reexecucao_de: ingestaoId }).then((ok) => {
                  if (ok) setConfirmando(false)
                })
              }}
            >
              {pendente && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Confirmar e executar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
