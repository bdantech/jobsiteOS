'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { aprovarLoteAction, cancelarLoteAction, executarLoteAction } from '@/actions/radar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarLote, contarItensDoLote, radarKeys } from './queries'

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const STATUS: Record<string, string> = {
  rascunho: 'Rascunho',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovado: 'Aprovado',
  executando: 'Executando',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  falhou: 'Falhou',
}
const ITEM_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  processando: 'Processando',
  aguardando_webhook: 'Aguardando webhook',
  sucesso: 'Sucesso',
  sem_dados: 'Sem dados',
  erro: 'Erro',
  pulado: 'Pulado',
}

export function LoteDetalhe({ id }: { id: string }) {
  const qc = useQueryClient()
  const [agindo, setAgindo] = React.useState(false)

  const ativo = (s?: string) => s === 'executando' || s === 'aprovado'

  const lote = useQuery({
    queryKey: radarKeys.lote(id),
    queryFn: () => buscarLote(id),
    refetchInterval: (q) => (ativo(q.state.data?.status) ? 4_000 : false),
  })
  const itens = useQuery({
    queryKey: radarKeys.loteItens(id),
    queryFn: () => contarItensDoLote(id),
    refetchInterval: () => (ativo(lote.data?.status) ? 4_000 : false),
  })

  async function agir<T>(
    fn: () => Promise<{ ok: true; data: T } | { ok: false; message: string; code?: string }>,
    sucesso: string,
    getAviso?: (d: T) => string | undefined,
  ) {
    setAgindo(true)
    const r = await fn()
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    const aviso = getAviso?.(r.data)
    if (aviso) toast.warning(`Aprovado, mas: ${aviso}`)
    else toast.success(sucesso)
    void qc.invalidateQueries({ queryKey: radarKeys.lote(id) })
    void qc.invalidateQueries({ queryKey: radarKeys.loteItens(id) })
    void qc.invalidateQueries({ queryKey: radarKeys.lotes() })
  }

  if (lote.isPending) return <Skeleton className="h-64 w-full" />
  if (!lote.data)
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Lote não encontrado.</p>
        <Button asChild variant="ghost">
          <Link href="/radar/lotes">← Voltar</Link>
        </Button>
      </div>
    )

  const l = lote.data
  const c = itens.data
  const podeAprovar = l.status === 'rascunho' || l.status === 'aguardando_aprovacao'
  const podeCancelar = podeAprovar || l.status === 'aprovado'
  const podeExecutar = l.status === 'aprovado'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/radar/lotes" className="text-sm text-muted-foreground hover:underline">
            ← Lotes
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{l.nome ?? `Lote de ${l.tipo}`}</h1>
          <p className="text-muted-foreground capitalize">
            {l.tipo} · {STATUS[l.status] ?? l.status}
          </p>
        </div>
        <div className="flex gap-2">
          {podeAprovar && (
            <Button
              onClick={() => agir(() => aprovarLoteAction(id), 'Lote aprovado e enfileirado.', (d) => d.aviso)}
              disabled={agindo}
            >
              Aprovar e executar
            </Button>
          )}
          {podeExecutar && (
            <Button
              variant="secondary"
              onClick={() => agir(() => executarLoteAction(id), 'Execução enfileirada.', (d) => d.aviso)}
              disabled={agindo}
            >
              Executar
            </Button>
          )}
          {podeCancelar && (
            <Button
              variant="ghost"
              onClick={() => agir(() => cancelarLoteAction(id), 'Lote cancelado.')}
              disabled={agindo}
            >
              Cancelar
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Itens</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{c?.total ?? l.total_itens ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Custo estimado</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{brl(Number(l.custo_estimado_esperado) || 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Custo real</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{brl(Number(l.custo_real) || 0)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Progresso</CardTitle>
        </CardHeader>
        <CardContent>
          {itens.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : !c || c.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              {l.status === 'aprovado'
                ? 'Aguardando o worker materializar os itens…'
                : 'Sem itens ainda (materializados na execução).'}
            </p>
          ) : (
            <div className="space-y-2">
              {Object.entries(c.porStatus).map(([status, qtd]) => (
                <div key={status} className="flex items-center gap-3 text-sm">
                  <span className="w-40 text-muted-foreground">{ITEM_LABEL[status] ?? status}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.round((qtd / c.total) * 100)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right tabular-nums">{qtd}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
