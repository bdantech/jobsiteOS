'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { atribuirNfAction } from '@/actions/comercial'
import { buscarFilaSemDono, buscarVendedores, comercialKeys } from './queries'

/**
 * As NFs vivas que nenhum território ou carteira reivindica.
 *
 * Esta fila é a saída honesta do roteador: em vez de empurrar a nota para alguém "mais
 * ou menos certo", ele devolve o caso a um humano. O valor dela é ser CURTA — uma fila
 * grande e permanente quer dizer que os territórios estão mal desenhados, e é isso que
 * o gestor deveria estar consertando em vez de atribuir nota a nota.
 *
 * Atribuir aqui grava `manual`, e o roteador nunca revisa manual.
 */

const brl = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export function FilaSemDono() {
  const qc = useQueryClient()
  const [agindo, setAgindo] = React.useState<string | null>(null)

  const fila = useQuery({ queryKey: comercialKeys.fila(), queryFn: buscarFilaSemDono })
  const vendedores = useQuery({ queryKey: comercialKeys.vendedores(), queryFn: buscarVendedores })
  const originadores = (vendedores.data ?? []).filter((v) => v.ativo && v.tipo === 'originador')

  async function atribuir(accessKey: string, vendedorId: string) {
    if (!vendedorId) return
    setAgindo(accessKey)
    const r = await atribuirNfAction({ access_key: accessKey, vendedor_id: vendedorId })
    setAgindo(null)
    if (!r.ok) return toast.error(r.message)
    toast.success('Nota atribuída. O roteamento automático não vai sobrescrever.')
    void qc.invalidateQueries({ queryKey: comercialKeys.fila() })
  }

  if (fila.isPending) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Fila sem dono</h1>
        <p className="text-sm text-muted-foreground">
          {(fila.data ?? []).length} nota(s) viva(s) que nenhum território ou carteira cobre.
          Fila comprida por muito tempo é sinal de território mal desenhado, não de trabalho manual.
        </p>
      </div>

      {(fila.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma nota órfã. Todo mundo tem dono.
          </CardContent>
        </Card>
      ) : originadores.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Não há originador ativo cadastrado — sem ele não há a quem atribuir.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {(fila.data ?? []).map((nf) => (
                <li key={nf.access_key} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {nf.fornecedor_nome ?? '—'} <span className="text-muted-foreground">→</span>{' '}
                      {nf.sacado_nome ?? '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      NF {nf.numero ?? '—'} · {brl(nf.valor)} · receita esperada{' '}
                      <strong className="tabular-nums">{brl(nf.receita_esperada)}</strong>
                      {nf.dias_para_vencimento !== null ? ` · vence em ${nf.dias_para_vencimento}d` : ''}
                    </p>
                  </div>
                  <select
                    aria-label={`Atribuir NF ${nf.numero ?? nf.access_key}`}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    disabled={agindo === nf.access_key}
                    defaultValue=""
                    onChange={(e) => void atribuir(nf.access_key, e.target.value)}
                  >
                    <option value="">Atribuir a…</option>
                    {originadores.map((v) => (
                      <option key={v.id} value={v.id}>{v.nome}</option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Button variant="outline" onClick={() => void qc.invalidateQueries({ queryKey: comercialKeys.fila() })}>
        Atualizar
      </Button>
    </div>
  )
}
