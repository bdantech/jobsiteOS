'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, ShieldCheck } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { sincronizarOnepayAction } from '@/actions/radar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarClientesOnepay, radarKeys } from './queries'

const brl = (n: number | null) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (n: number | null) => `${Math.round((Number(n) || 0) * 100)}%`

const DORMENTE = 15

/**
 * Busca no cliente, não no servidor: a lista inteira já veio numa consulta só (são
 * dezenas de clientes, não milhares), então filtrar aqui responde a cada tecla sem
 * uma ida ao banco por letra.
 *
 * O CNPJ é comparado só por dígitos. Quem cola "12.345.678/0001-90" de outro sistema
 * não deveria precisar apagar a pontuação para achar a empresa — e quem digita
 * "12345678" também acha.
 */
function combina(cliente: { nome: string | null; cnpj: string }, termo: string): boolean {
  const t = termo.trim().toLowerCase()
  if (!t) return true

  const digitos = t.replace(/\D/g, '')
  if (digitos.length >= 3 && cliente.cnpj.includes(digitos)) return true

  return (cliente.nome ?? '').toLowerCase().includes(t)
}

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
  const [termo, setTermo] = React.useState('')

  const todos = React.useMemo(() => clientes.data ?? [], [clientes.data])
  const filtrados = React.useMemo(() => todos.filter((c) => combina(c, termo)), [todos, termo])

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
        <div className="flex shrink-0 items-center gap-2">
          {/* Rota própria (04b §4): o grid matriz × SPEs não cabe dentro de uma aba. */}
          <Button variant="outline" asChild>
            <Link href="/empresas/certificados">
              <ShieldCheck className="mr-1 h-4 w-4" aria-hidden />
              Gestão de certificados
            </Link>
          </Button>
          <Button onClick={sincronizar} disabled={sincronizando}>
            {sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
          </Button>
        </div>
      </div>

      {clientes.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : todos.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum cliente sincronizado ainda. Rode o sync Onepay no worker.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
            <div className="relative min-w-64 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Buscar por nome ou CNPJ"
                className="pl-9"
                aria-label="Buscar clientes Onepay"
              />
            </div>
            <span className="shrink-0 text-sm text-muted-foreground">
              {termo.trim()
                ? `${filtrados.length} de ${todos.length}`
                : `${todos.length} cliente(s)`}
            </span>
          </div>
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
                {filtrados.map((c) => {
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
            {filtrados.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhum cliente para “{termo.trim()}”.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
