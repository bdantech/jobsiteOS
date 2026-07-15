'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, DatabaseZap, Info, RefreshCw } from 'lucide-react'
import {
  FONTES_INGESTAO,
  FONTE_INGESTAO_LABELS,
  STATUS_INGESTAO,
  STATUS_INGESTAO_LABELS,
  type FonteIngestao,
  type StatusIngestao,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AcoesReexecucao, ExecutarAgora } from './acoes-execucao'
import { TODOS, isJobDoWorker } from './constants'
import { formatContador, formatDataHora, formatDuracao } from './format'
import { IngestaoDetalheDialog } from './ingestao-detalhe-dialog'
import {
  INTERVALO_EXECUTANDO_MS,
  INTERVALO_OCIOSO_MS,
  buscarIngestoes,
  fontesEmExecucao,
  ingestoesKeys,
  temExecucaoAtiva,
  type Ingestao,
} from './queries'
import { StatusBadge, labelFonte } from './status-badge'

const COLUNAS = 9

function LinhasCarregando() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: COLUNAS }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

function Vazio({ filtrado, onLimpar }: { filtrado: boolean; onLimpar: () => void }) {
  return (
    <TableRow>
      <TableCell colSpan={COLUNAS} className="h-64">
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-full bg-muted p-3">
            <DatabaseZap className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-medium">
              {filtrado ? 'Nenhuma execução encontrada' : 'Nenhuma ingestão executada ainda'}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              {filtrado
                ? 'Ajuste os filtros para ver outras execuções.'
                : 'As cargas mensais da Receita Federal e do CNO rodam por cron. Você também pode disparar uma agora.'}
            </p>
          </div>
          {filtrado && (
            <Button variant="outline" size="sm" onClick={onLimpar}>
              Limpar filtros
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function Erro({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return (
    <TableRow>
      <TableCell colSpan={COLUNAS} className="h-64">
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-medium">Não foi possível carregar as ingestões</p>
            <p className="max-w-md text-sm text-muted-foreground">{mensagem}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onTentar}>
            Tentar novamente
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

export function IngestoesLista({ podeExecutar }: { podeExecutar: boolean }) {
  const [fonte, setFonte] = React.useState<FonteIngestao | null>(null)
  const [status, setStatus] = React.useState<StatusIngestao | null>(null)
  const [selecionada, setSelecionada] = React.useState<Ingestao | null>(null)

  const query = useQuery({
    queryKey: ingestoesKeys.lista(fonte, status),
    queryFn: () => buscarIngestoes(fonte, status),
    // Live-ish without Realtime: mercado_ingestoes is not in the supabase_realtime
    // publication (only `notificacoes` is), so a running job is followed by
    // polling — fast while something is in flight, slow when the page is idle.
    refetchInterval: (q) => {
      const dados = q.state.data
      return dados && temExecucaoAtiva(dados) ? INTERVALO_EXECUTANDO_MS : INTERVALO_OCIOSO_MS
    },
  })

  const ingestoes = React.useMemo(() => query.data ?? [], [query.data])
  const rodando = temExecucaoAtiva(ingestoes)

  /**
   * A running job has no `terminado_em`, so its duration is "now minus start".
   * Tick a clock only while something is actually running — no interval left
   * spinning on an idle admin page.
   */
  const [agoraMs, setAgoraMs] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!rodando) return
    setAgoraMs(Date.now())
    const timer = window.setInterval(() => setAgoraMs(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [rodando])

  /**
   * Computed over the CURRENT PAGE of runs. The filters could hide a running job
   * of another fonte, which would let an admin start a second one — the server
   * action re-checks it against the whole table and refuses, so the worst case is
   * an honest error toast, not a duplicated multi-GB download.
   */
  const emExecucao = React.useMemo(() => fontesEmExecucao(ingestoes), [ingestoes])

  const filtrado = fonte !== null || status !== null

  function limparFiltros() {
    setFonte(null)
    setStatus(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Ingestões</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Execuções do worker: carga mensal da Receita Federal (CNPJ), do CNO (obras) e as
            importações de lista. As cargas mensais rodam por cron — esta página existe para
            acompanhar, diagnosticar e reexecutar.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            title="Atualizar agora"
            aria-label="Atualizar agora"
          >
            <RefreshCw
              className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`}
              aria-hidden
            />
          </Button>
          {podeExecutar && <ExecutarAgora fontesBloqueadas={emExecucao} />}
        </div>
      </div>

      {!podeExecutar && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Você pode acompanhar as execuções, mas apenas administradores podem disparar ou
            reexecutar uma ingestão.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Select
          value={fonte ?? TODOS}
          onValueChange={(v) => setFonte(v === TODOS ? null : (v as FonteIngestao))}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Fonte" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas as fontes</SelectItem>
            {FONTES_INGESTAO.map((f) => (
              <SelectItem key={f} value={f}>
                {FONTE_INGESTAO_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={status ?? TODOS}
          onValueChange={(v) => setStatus(v === TODOS ? null : (v as StatusIngestao))}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os status</SelectItem>
            {STATUS_INGESTAO.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_INGESTAO_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtrado && (
          <Button variant="ghost" size="sm" onClick={limparFiltros}>
            Limpar filtros
          </Button>
        )}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fonte</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Tent.</TableHead>
              <TableHead className="text-right">Processadas</TableHead>
              <TableHead className="text-right">Novas</TableHead>
              <TableHead className="text-right">Atualizadas</TableHead>
              <TableHead>Início</TableHead>
              <TableHead className="text-right">Duração</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending ? (
              <LinhasCarregando />
            ) : query.isError ? (
              <Erro
                mensagem={
                  query.error instanceof Error
                    ? query.error.message
                    : 'Erro desconhecido ao consultar o banco.'
                }
                onTentar={() => void query.refetch()}
              />
            ) : ingestoes.length === 0 ? (
              <Vazio filtrado={filtrado} onLimpar={limparFiltros} />
            ) : (
              ingestoes.map((ingestao) => {
                // Narrow `fonte` (a plain text column, so `string` to TS) once, here.
                // null = an importação de lista: nothing for the worker to re-fire.
                const fonteJob = isJobDoWorker(ingestao.fonte) ? ingestao.fonte : null
                const bloqueado =
                  emExecucao.has(ingestao.fonte) && ingestao.status !== 'executando'

                return (
                  <TableRow
                    key={ingestao.id}
                    className="cursor-pointer"
                    onClick={() => setSelecionada(ingestao)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelecionada(ingestao)
                      }
                    }}
                  >
                    <TableCell className="font-medium">{labelFonte(ingestao.fonte)}</TableCell>
                    <TableCell>
                      <StatusBadge status={ingestao.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{ingestao.tentativa}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatContador(ingestao.linhas_processadas)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatContador(ingestao.linhas_novas)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatContador(ingestao.linhas_atualizadas)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDataHora(ingestao.iniciado_em)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {formatDuracao(ingestao.iniciado_em, ingestao.terminado_em, agoraMs)}
                    </TableCell>
                    <TableCell className="text-right">
                      {podeExecutar && fonteJob !== null ? (
                        // The buttons live inside the row, but the row is a link to
                        // the detail sheet — a click on either must not do both.
                        <div
                          className="flex justify-end"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                          role="presentation"
                        >
                          <AcoesReexecucao
                            ingestaoId={ingestao.id}
                            fonte={fonteJob}
                            status={ingestao.status}
                            bloqueado={bloqueado}
                            compacto
                          />
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <IngestaoDetalheDialog
        ingestao={selecionada}
        aberto={selecionada !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setSelecionada(null)
        }}
        podeExecutar={podeExecutar}
        fontesEmExecucao={emExecucao}
        agoraMs={agoraMs}
      />
    </div>
  )
}
