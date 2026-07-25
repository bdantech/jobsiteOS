'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatCnpj } from '@jobsiteos/core'
import { sincronizarOnepayAction } from '@/actions/radar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarClientesOnepay, radarKeys } from './queries'

const brl = (n: number | null) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (n: number | null) => `${Math.round((Number(n) || 0) * 100)}%`

const DORMENTE = 15

function Sinal({ children, tom }: { children: React.ReactNode; tom: 'alerta' | 'aviso' | 'ok' }) {
  const cor =
    tom === 'alerta'
      ? 'bg-destructive/10 text-destructive'
      : tom === 'aviso'
        ? 'bg-amber-500/10 text-amber-600'
        : 'bg-muted text-muted-foreground'
  return <span className={`rounded px-1.5 py-0.5 text-xs ${cor}`}>{children}</span>
}

export function ClientesOnepay() {
  const qc = useQueryClient()
  const clientes = useQuery({ queryKey: radarKeys.clientes(), queryFn: buscarClientesOnepay })
  const [sincronizando, setSincronizando] = React.useState(false)

  async function sincronizar() {
    setSincronizando(true)
    const r = await sincronizarOnepayAction()
    if (!r.ok) {
      setSincronizando(false)
      toast.error(r.message)
      return
    }
    if (!r.data.enfileirado) {
      setSincronizando(false)
      toast.error(r.data.aviso ?? 'O worker não aceitou o sync.')
      return
    }
    toast.success('Sync enfileirado. Os clientes aparecem em instantes — atualizando…')
    // O sync roda em background no worker; recarrega algumas vezes enquanto chega.
    let tentativas = 0
    const timer = setInterval(() => {
      tentativas++
      void qc.invalidateQueries({ queryKey: radarKeys.clientes() })
      if (tentativas >= 12) {
        clearInterval(timer)
        setSincronizando(false)
      }
    }, 5_000)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clientes Onepay</h1>
          <p className="text-muted-foreground">Sync diário: limites, dias sem antecipar e sinais.</p>
        </div>
        <Button onClick={sincronizar} disabled={sincronizando}>
          {sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
        </Button>
      </div>

      {clientes.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (clientes.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum cliente sincronizado ainda. Rode o sync Onepay no worker.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Empresa</th>
                  <th className="px-4 py-2 font-medium">Limite</th>
                  <th className="px-4 py-2 font-medium">Consumido</th>
                  <th className="px-4 py-2 font-medium">Sem antecipar</th>
                  <th className="px-4 py-2 font-medium">Sinais</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(clientes.data ?? []).map((c) => {
                  const dias = c.days_without_anticipation ?? 0
                  const pctConsumido = Number(c.consumed_pct) || 0
                  return (
                    <tr key={c.cnpj} className="hover:bg-muted/50">
                      <td className="px-4 py-2">
                        {c.empresa_id ? (
                          <Link href={`/empresas/${c.empresa_id}`} className="font-medium hover:underline">
                            {c.nome ?? formatCnpj(c.cnpj)}
                          </Link>
                        ) : (
                          <span className="font-medium">{c.nome ?? formatCnpj(c.cnpj)}</span>
                        )}
                        <div className="text-xs text-muted-foreground">{formatCnpj(c.cnpj)}</div>
                      </td>
                      <td className="px-4 py-2 tabular-nums">{brl(c.credit_limit)}</td>
                      <td className="px-4 py-2 tabular-nums">{pct(c.consumed_pct)}</td>
                      <td className="px-4 py-2 tabular-nums">{dias} d</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {dias >= DORMENTE && <Sinal tom="aviso">Dormente</Sinal>}
                          {pctConsumido >= 0.9 && <Sinal tom="alerta">Limite {pct(c.consumed_pct)}</Sinal>}
                          {c.operation_status && c.operation_status !== 'operating_normally' && (
                            <Sinal tom="aviso">{c.operation_status}</Sinal>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
