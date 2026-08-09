'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ORIGEM_LANCAMENTO_LABELS, STATUS_LANCAMENTO_LABELS, TIPO_VENDEDOR_LABELS,
  type OrigemLancamento, type StatusLancamento, type TipoVendedorId,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { mudarStatusComissaoAction } from '@/actions/comercial'
import { buscarComissoes, comercialKeys, type LancamentoComVendedor } from './queries'

/**
 * Comissão por competência, agrupada por vendedor, com drill até a origem de cada linha.
 *
 * O ciclo apurado → aprovado → pago é uma via de mão única na tela: `pago` não volta
 * para `aprovado` por um clique distraído (o RPC recusa). Aprovar é por VENDEDOR e por
 * MÊS, não linha a linha — aprovar 40 linhas uma a uma é o tipo de tarefa que leva
 * alguém a aprovar sem ler.
 */

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const CORES: Record<StatusLancamento, string> = {
  apurado: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  aprovado: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200',
  pago: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
}

function mesCorrente(): string {
  return new Date().toISOString().slice(0, 7)
}

export function Comissoes({ ehGestor }: { ehGestor: boolean }) {
  const qc = useQueryClient()
  const [mes, setMes] = React.useState(mesCorrente)
  const [agindo, setAgindo] = React.useState(false)
  const competencia = `${mes}-01`

  const { data, isPending } = useQuery({
    queryKey: comercialKeys.comissoes(competencia),
    queryFn: () => buscarComissoes(competencia),
  })

  async function mudar(vendedorId: string, status: 'aprovado' | 'pago') {
    setAgindo(true)
    const r = await mudarStatusComissaoAction({ vendedor_id: vendedorId, competencia, status })
    setAgindo(false)
    if (!r.ok) return toast.error(r.message)
    if (r.data.linhas === 0) {
      // Zero linhas não é erro: é "não havia nada nesse estado". Dizer "aprovado" seria
      // mentir sobre uma transição que não aconteceu.
      toast.warning('Nada mudou — nenhuma linha estava no estado anterior.')
    } else {
      toast.success(`${r.data.linhas} lançamento(s) → ${STATUS_LANCAMENTO_LABELS[status]}.`)
    }
    void qc.invalidateQueries({ queryKey: comercialKeys.comissoes(competencia) })
  }

  const porVendedor = new Map<string, { nome: string; tipo: string; linhas: LancamentoComVendedor[] }>()
  for (const l of data ?? []) {
    const id = l.vendedor_id
    const atual = porVendedor.get(id) ?? {
      nome: l.vendedores?.nome ?? '—',
      tipo: l.vendedores?.tipo ?? '',
      linhas: [],
    }
    atual.linhas.push(l)
    porVendedor.set(id, atual)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Comissões</h1>
          <p className="text-sm text-muted-foreground">
            Apurado ainda não é aprovado, e aprovado ainda não é pago.
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor="mes" className="text-xs text-muted-foreground">Competência</label>
          <Input id="mes" type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-44" />
        </div>
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : porVendedor.size === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum lançamento nesta competência. A apuração roda no dia 1 e fecha o mês anterior.
          </CardContent>
        </Card>
      ) : (
        [...porVendedor.entries()].map(([id, v]) => {
          const total = v.linhas.reduce((s, l) => s + Number(l.valor), 0)
          const temApurado = v.linhas.some((l) => l.status === 'apurado')
          const temAprovado = v.linhas.some((l) => l.status === 'aprovado')
          return (
            <Card key={id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-base">
                    {v.nome}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {TIPO_VENDEDOR_LABELS[v.tipo as TipoVendedorId] ?? v.tipo}
                    </span>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold tabular-nums">{brl(total)}</span>
                    {ehGestor && temApurado && (
                      <Button size="sm" disabled={agindo} onClick={() => void mudar(id, 'aprovado')}>
                        Aprovar
                      </Button>
                    )}
                    {ehGestor && temAprovado && (
                      <Button size="sm" variant="outline" disabled={agindo} onClick={() => void mudar(id, 'pago')}>
                        Marcar pago
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {v.linhas.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                      <span className="flex items-baseline gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {ORIGEM_LANCAMENTO_LABELS[l.origem_tipo as OrigemLancamento] ?? l.origem_tipo}
                        </Badge>
                        <span className="text-muted-foreground">{l.descricao}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge className={`text-[10px] ${CORES[l.status as StatusLancamento] ?? ''}`}>
                          {STATUS_LANCAMENTO_LABELS[l.status as StatusLancamento] ?? l.status}
                        </Badge>
                        <span
                          className={`tabular-nums ${Number(l.valor) < 0 ? 'font-medium text-destructive' : ''}`}
                        >
                          {brl(Number(l.valor))}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
