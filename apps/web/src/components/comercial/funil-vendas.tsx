'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronRight } from 'lucide-react'
import { ESTAGIOS_VENDA, ESTAGIO_VENDA_LABELS, type EstagioVenda } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { moverVendaAction } from '@/actions/comercial'
import {
  buscarMotivos, buscarVendas, buscarVendedores, comercialKeys, type VendaComEmpresa,
} from './queries'

/**
 * Funil do closer. Kanban com avanço de um clique e uma única fricção deliberada:
 * PERDER exige motivo.
 *
 * A fricção é o ponto do funil. Sem motivo obrigatório, "perdido" vira lixeira — e a
 * pergunta que mais importa depois de um trimestre ruim ("por que estamos perdendo?")
 * fica sem resposta justamente porque foi fácil demais responder na hora.
 *
 * `em_analise_credito` não avança por aqui: quem move é a decisão da seguradora (04d),
 * pelo worker. Aprovada vai para proposta, negada encerra com "Crédito negado", parcial
 * fica parada de propósito.
 */

const ORDEM = ESTAGIOS_VENDA.filter((e) => e !== 'perdido')

/** O próximo passo natural. Null = não se avança daqui por clique. */
function proximo(e: EstagioVenda): EstagioVenda | null {
  if (e === 'em_analise_credito' || e === 'ganho' || e === 'perdido') return null
  const i = ORDEM.indexOf(e)
  return i >= 0 && i < ORDEM.length - 1 ? (ORDEM[i + 1] as EstagioVenda) : null
}

export function FunilVendas({ ehGestor }: { ehGestor: boolean }) {
  const qc = useQueryClient()
  const [vendedorId, setVendedorId] = React.useState<string | null>(null)
  const [perdendo, setPerdendo] = React.useState<VendaComEmpresa | null>(null)
  const [agindo, setAgindo] = React.useState(false)

  const vendedores = useQuery({ queryKey: comercialKeys.vendedores(), queryFn: buscarVendedores })
  const vendas = useQuery({ queryKey: comercialKeys.vendas(vendedorId), queryFn: () => buscarVendas(vendedorId) })
  const motivos = useQuery({
    queryKey: comercialKeys.motivos('funil_vendedor'),
    queryFn: () => buscarMotivos('funil_vendedor'),
  })

  async function mover(v: VendaComEmpresa, estagio: EstagioVenda, extra: Record<string, unknown> = {}) {
    setAgindo(true)
    const r = await moverVendaAction({ venda_id: v.id, estagio, ...extra })
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success(
      estagio === 'ganho'
        ? 'Venda ganha. Falta definir se a conta será ativa ou passiva na ficha da empresa.'
        : `Movido para ${ESTAGIO_VENDA_LABELS[estagio]}.`,
    )
    void qc.invalidateQueries({ queryKey: ['comercial'] })
    return true
  }

  if (vendas.isPending) return <Skeleton className="h-96 w-full" />

  const porEstagio = new Map<string, VendaComEmpresa[]>()
  for (const v of vendas.data ?? []) porEstagio.set(v.estagio, [...(porEstagio.get(v.estagio) ?? []), v])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Funil de vendas</h1>
          <p className="text-sm text-muted-foreground">
            {(vendas.data ?? []).length} card(s). Perder exige motivo; a análise de crédito move o
            card sozinha quando a seguradora decide.
          </p>
        </div>
        {ehGestor && (
          <Select value={vendedorId ?? 'todos'} onValueChange={(v) => setVendedorId(v === 'todos' ? null : v)}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Todos os vendedores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os vendedores</SelectItem>
              {(vendedores.data ?? [])
                .filter((v) => v.tipo === 'vendedor')
                .map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {ESTAGIOS_VENDA.map((coluna) => {
          const itens = porEstagio.get(coluna) ?? []
          const seguinte = proximo(coluna)
          return (
            <div key={coluna} className="w-72 shrink-0">
              <Card className="h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-baseline justify-between text-sm">
                    {ESTAGIO_VENDA_LABELS[coluna]}
                    <span className="text-xs tabular-nums text-muted-foreground">{itens.length}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {itens.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">—</p>
                  ) : (
                    itens.map((v) => (
                      <div key={v.id} className="space-y-1.5 rounded-md border p-2 text-sm">
                        <Link
                          href={v.empresas ? `/empresas/${v.empresas.id}` : '#'}
                          className="block font-medium hover:underline"
                        >
                          {v.empresas?.razao_social ?? 'Empresa'}
                        </Link>
                        {v.empresas?.uf ? (
                          <Badge variant="outline" className="text-[10px]">{v.empresas.uf}</Badge>
                        ) : null}
                        {coluna === 'em_analise_credito' && (
                          <p className="text-[11px] text-muted-foreground">
                            Aguardando a seguradora. O card anda sozinho quando ela decidir.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {seguinte && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={agindo}
                              onClick={() => void mover(v, seguinte)}>
                              {ESTAGIO_VENDA_LABELS[seguinte]}
                              <ChevronRight className="ml-0.5 h-3 w-3" aria-hidden />
                            </Button>
                          )}
                          {coluna !== 'ganho' && coluna !== 'perdido' && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={agindo}
                              onClick={() => setPerdendo(v)}>
                              Perdi
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          )
        })}
      </div>

      <Dialog open={perdendo !== null} onOpenChange={(v) => !v && setPerdendo(null)}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!perdendo) return
              const motivo = String(new FormData(e.currentTarget).get('motivo') ?? '')
              const ok = await mover(perdendo, 'perdido', { perdido_motivo: motivo })
              if (ok) setPerdendo(null)
            }}
          >
            <DialogHeader>
              <DialogTitle>Marcar como perdida</DialogTitle>
              <DialogDescription>
                O motivo é obrigatório. É a única coisa que sobra de uma venda perdida — e a
                única que responde &quot;por que estamos perdendo?&quot; três meses depois.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="motivo">Motivo</Label>
              <select
                id="motivo"
                name="motivo"
                required
                className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione…</option>
                {(motivos.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.motivo}</option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPerdendo(null)}>Cancelar</Button>
              <Button type="submit" variant="destructive" disabled={agindo}>Marcar perdida</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
