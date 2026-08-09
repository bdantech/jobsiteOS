'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronRight } from 'lucide-react'
import {
  ESTAGIOS_VENDA, ESTAGIO_VENDA_LABELS, SITUACAO_VENDA_LABELS, vendaNoFunil,
  type EstagioVenda, type SituacaoVenda,
} from '@jobsiteos/core'
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
  buscarMotivos, buscarVendas, buscarVendedores, buscarVendedoresVisiveis, comercialKeys,
  type VendaComEmpresa,
} from './queries'

/**
 * Funil do closer.
 *
 * O ESTÁGIO diz onde o negócio está; GANHO e PERDIDO são situação, e não movem o card.
 * Um negócio ganho pode estar em onboarding — e é lá que o trabalho continua. Como
 * coluna, "ganho" tirava o card da etapa onde o trabalho acontece justamente quando ele
 * passou a exigir trabalho de verdade.
 *
 * Ganho CONTINUA no funil até a primeira operação. Depois dela some sozinho: já está
 * ganho e operando, e rotina não mora em funil.
 *
 * Uma fricção deliberada: PERDER exige motivo. Sem ela, "perdido" vira lixeira — e a
 * pergunta que mais importa depois de um trimestre ruim ("por que estamos perdendo?")
 * fica sem resposta porque foi fácil demais responder na hora.
 *
 * `em_analise_credito` não avança por clique: quem move é a decisão da seguradora (04d).
 * Aprovada vai para proposta, negada encerra onde está, parcial fica parada de propósito.
 */

/** O próximo passo natural. Null = não se avança daqui por clique. */
function proximo(e: EstagioVenda): EstagioVenda | null {
  if (e === 'em_analise_credito') return null
  const i = ESTAGIOS_VENDA.indexOf(e)
  return i >= 0 && i < ESTAGIOS_VENDA.length - 1 ? (ESTAGIOS_VENDA[i + 1] as EstagioVenda) : null
}

export function FunilVendas({ ehGestor }: { ehGestor: boolean }) {
  const qc = useQueryClient()
  const [vendedorId, setVendedorId] = React.useState<string | null>(null)
  const [perdendo, setPerdendo] = React.useState<VendaComEmpresa | null>(null)
  const [agindo, setAgindo] = React.useState(false)
  // Fora do funil = perdido, ou ganho que já operou. Escondidos por padrão: o kanban é
  // a fila de trabalho, e nenhum dos dois pede trabalho.
  const [mostrarEncerrados, setMostrarEncerrados] = React.useState(false)

  const vendedores = useQuery({ queryKey: comercialKeys.vendedores(), queryFn: buscarVendedores })
  // Quem eu posso ABRIR — não é a mesma lista de quem existe. O seletor sai daqui para
  // não oferecer um funil que a RLS devolveria vazio.
  const alcance = useQuery({ queryKey: comercialKeys.visiveis(), queryFn: buscarVendedoresVisiveis })
  const vendas = useQuery({ queryKey: comercialKeys.vendas(vendedorId), queryFn: () => buscarVendas(vendedorId) })
  const motivos = useQuery({
    queryKey: comercialKeys.motivos('funil_vendedor'),
    queryFn: () => buscarMotivos('funil_vendedor'),
  })

  // Gestor sempre vê o seletor: para ele "todos" é uma informação, não um default
  // silencioso. Vendedor comum só vê quando há realmente mais de um funil ao alcance.
  const closersVisiveis = (alcance.data ?? []).filter((v) => v.tipo === 'vendedor')
  const mostrarSeletor = ehGestor || closersVisiveis.length > 1

  async function mover(v: VendaComEmpresa, estagio: EstagioVenda) {
    setAgindo(true)
    const r = await moverVendaAction({ venda_id: v.id, estagio })
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success(`Movido para ${ESTAGIO_VENDA_LABELS[estagio]}.`)
    void qc.invalidateQueries({ queryKey: ['comercial'] })
    return true
  }

  /** Ganhar ou perder. NÃO move o card — o estágio diz onde o negócio está. */
  async function encerrar(v: VendaComEmpresa, situacao: SituacaoVenda, motivo?: string) {
    setAgindo(true)
    const r = await moverVendaAction({
      venda_id: v.id,
      situacao,
      perdido_motivo: motivo ?? null,
    })
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success(
      situacao === 'ganho'
        ? 'Venda ganha — a empresa virou cliente. Falta definir se a conta será ativa ou passiva na ficha dela.'
        : situacao === 'perdido'
          ? 'Venda perdida. O card fica onde estava, e é isso que diz até onde ela chegou.'
          : 'Negócio reaberto.',
    )
    void qc.invalidateQueries({ queryKey: ['comercial'] })
    return true
  }

  if (vendas.isPending) return <Skeleton className="h-96 w-full" />

  const visiveis = (vendas.data ?? []).filter((v) => mostrarEncerrados || vendaNoFunil(v))
  const foraDoFunil = (vendas.data ?? []).filter((v) => !vendaNoFunil(v)).length

  const porEstagio = new Map<string, VendaComEmpresa[]>()
  for (const v of visiveis) porEstagio.set(v.estagio, [...(porEstagio.get(v.estagio) ?? []), v])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Funil de vendas</h1>
          <p className="text-sm text-muted-foreground">
            {visiveis.length} card(s). Ganho e perdido são situação, não coluna — o card fica
            onde está. Ganho só sai do funil quando o cliente faz a primeira operação.
          </p>
        </div>
        <div className="flex items-center gap-3">
        {foraDoFunil > 0 && (
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={mostrarEncerrados}
              onChange={(e) => setMostrarEncerrados(e.target.checked)}
            />
            Mostrar {foraDoFunil} fora do funil
          </label>
        )}
        {mostrarSeletor && (
          <Select value={vendedorId ?? 'todos'} onValueChange={(v) => setVendedorId(v === 'todos' ? null : v)}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Todos os vendedores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os vendedores</SelectItem>
              {closersVisiveis.map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        </div>
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
                      <div
                        key={v.id}
                        className={`space-y-1.5 rounded-md border p-2 text-sm ${
                          v.situacao === 'perdido' || v.primeira_operacao_em ? 'opacity-60' : ''
                        }`}
                      >
                        <Link
                          href={v.empresas ? `/empresas/${v.empresas.id}` : '#'}
                          className="block font-medium hover:underline"
                        >
                          {v.empresas?.razao_social ?? 'Empresa'}
                        </Link>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {v.empresas?.uf ? (
                            <Badge variant="outline" className="text-[10px]">{v.empresas.uf}</Badge>
                          ) : null}
                          {/* Situação no card, não na coluna: o negócio tem as duas coisas. */}
                          {v.situacao === 'ganho' ? (
                            <Badge className="bg-emerald-100 text-[10px] text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200">
                              {SITUACAO_VENDA_LABELS.ganho}
                            </Badge>
                          ) : v.situacao === 'perdido' ? (
                            <Badge variant="destructive" className="text-[10px]">
                              {SITUACAO_VENDA_LABELS.perdido}
                            </Badge>
                          ) : null}
                          {v.primeira_operacao_em ? (
                            <Badge variant="secondary" className="text-[10px]">Já operando</Badge>
                          ) : null}
                        </div>
                        {coluna === 'em_analise_credito' && v.situacao === 'em_andamento' && (
                          <p className="text-[11px] text-muted-foreground">
                            Aguardando a seguradora. O card anda sozinho quando ela decidir.
                          </p>
                        )}
                        {v.situacao === 'ganho' && !v.primeira_operacao_em && (
                          <p className="text-[11px] text-muted-foreground">
                            Ganho, sem operar ainda — sai do funil na primeira antecipação.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {v.situacao === 'perdido' ? (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={agindo}
                              onClick={() => void encerrar(v, 'em_andamento')}>
                              Reabrir
                            </Button>
                          ) : (
                            <>
                              {/* Avançar o estágio vale mesmo já ganho: onboarding é
                                  trabalho, e é a etapa que o card ainda percorre. */}
                              {seguinte && (
                                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={agindo}
                                  onClick={() => void mover(v, seguinte)}>
                                  {ESTAGIO_VENDA_LABELS[seguinte]}
                                  <ChevronRight className="ml-0.5 h-3 w-3" aria-hidden />
                                </Button>
                              )}
                              {v.situacao === 'em_andamento' && (
                                <>
                                  <Button size="sm" className="h-7 text-xs" disabled={agindo}
                                    onClick={() => void encerrar(v, 'ganho')}>
                                    Ganhei
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={agindo}
                                    onClick={() => setPerdendo(v)}>
                                    Perdi
                                  </Button>
                                </>
                              )}
                            </>
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
              const ok = await encerrar(perdendo, 'perdido', motivo)
              if (ok) setPerdendo(null)
            }}
          >
            <DialogHeader>
              <DialogTitle>Marcar como perdida</DialogTitle>
              <DialogDescription>
                O card fica <strong>onde está</strong> — é o estágio que diz até onde a venda
                chegou antes de morrer. O motivo é obrigatório: é a única coisa que sobra de
                uma venda perdida, e a única que responde &quot;por que estamos perdendo?&quot;
                três meses depois.
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
