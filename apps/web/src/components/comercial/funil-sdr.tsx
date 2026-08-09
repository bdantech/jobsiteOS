'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarPlus, ChevronRight } from 'lucide-react'
import {
  ESTAGIOS_SDR,
  ESTAGIO_SDR_LABELS,
  TIPO_VENDEDOR_LABELS,
  type EstagioSdr,
  type TipoVendedorId,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { moverLeadAction } from '@/actions/comercial'
import {
  buscarLeads, buscarMotivos, buscarVendedores, comercialKeys, type LeadComEmpresa,
} from './queries'

/**
 * Funil de reuniões do SDR — kanban por estágio.
 *
 * Duas saídas exigem mais que um clique, e isso é deliberado: **sem fit** pede motivo
 * (é o dado que diz por que a régua do Mercado está errada, e alimenta o Perfil 04f) e
 * **agendar** pede data e vendedor destino. Tudo o mais é um clique só — um funil onde
 * mover custa três telas é um funil que fica desatualizado.
 */

const brl = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** As colunas do kanban, na ordem do trabalho. Encerrados ficam no fim. */
const COLUNAS = ESTAGIOS_SDR

export function FunilSdr({ ehGestor }: { ehGestor: boolean }) {
  const qc = useQueryClient()
  const [sdrId, setSdrId] = React.useState<string | null>(null)
  const [agendando, setAgendando] = React.useState<LeadComEmpresa | null>(null)
  const [semFit, setSemFit] = React.useState<LeadComEmpresa | null>(null)
  const [agindo, setAgindo] = React.useState(false)

  const vendedores = useQuery({ queryKey: comercialKeys.vendedores(), queryFn: buscarVendedores })
  const leads = useQuery({ queryKey: comercialKeys.leads(sdrId), queryFn: () => buscarLeads(sdrId) })
  const motivos = useQuery({
    queryKey: comercialKeys.motivos('sdr_sem_fit'),
    queryFn: () => buscarMotivos('sdr_sem_fit'),
  })

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['comercial'] })
  }

  async function mover(lead: LeadComEmpresa, estagio: EstagioSdr, extra: Record<string, unknown> = {}) {
    setAgindo(true)
    const r = await moverLeadAction({ lead_id: lead.id, estagio, ...extra })
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success(`Movido para ${ESTAGIO_SDR_LABELS[estagio]}.`)
    recarregar()
    return true
  }

  if (leads.isPending) return <Skeleton className="h-96 w-full" />

  const porEstagio = new Map<string, LeadComEmpresa[]>()
  for (const l of leads.data ?? []) {
    porEstagio.set(l.estagio, [...(porEstagio.get(l.estagio) ?? []), l])
  }

  const closers = (vendedores.data ?? []).filter((v) => v.ativo && v.tipo === 'vendedor')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Funil de reuniões</h1>
          <p className="text-sm text-muted-foreground">
            {(leads.data ?? []).length} lead(s). Sem fit exige motivo — é ele que ensina a régua.
          </p>
        </div>
        {ehGestor && (
          <Select value={sdrId ?? 'todos'} onValueChange={(v) => setSdrId(v === 'todos' ? null : v)}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Todos os SDRs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os SDRs</SelectItem>
              {(vendedores.data ?? [])
                .filter((v) => v.tipo === 'sdr')
                .map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUNAS.map((coluna) => {
          const itens = porEstagio.get(coluna) ?? []
          return (
            <div key={coluna} className="w-72 shrink-0">
              <Card className="h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-baseline justify-between text-sm">
                    {ESTAGIO_SDR_LABELS[coluna]}
                    <span className="text-xs tabular-nums text-muted-foreground">{itens.length}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {itens.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">—</p>
                  ) : (
                    itens.map((l) => (
                      <div key={l.id} className="space-y-1.5 rounded-md border p-2 text-sm">
                        <Link
                          href={l.empresas ? `/empresas/${l.empresas.id}` : '#'}
                          className="block font-medium hover:underline"
                        >
                          {l.empresas?.razao_social ?? 'Empresa'}
                        </Link>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          {l.empresas?.uf ? <Badge variant="outline" className="text-[10px]">{l.empresas.uf}</Badge> : null}
                          <span className="tabular-nums">{brl(l.empresas?.valor_esperado_mensal)}/mês esperado</span>
                        </div>
                        {/*
                          Só os próximos passos plausíveis. Um menu com os nove estágios
                          transformaria "mover" numa decisão, quando é um registro.
                        */}
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {coluna === 'a_contatar' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={agindo}
                              onClick={() => void mover(l, 'em_conversa')}>
                              Em conversa
                            </Button>
                          )}
                          {(coluna === 'a_contatar' || coluna === 'em_conversa') && (
                            <>
                              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={agindo}
                                onClick={() => void mover(l, 'com_fit')}>
                                Com fit
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={agindo}
                                onClick={() => setSemFit(l)}>
                                Sem fit
                              </Button>
                            </>
                          )}
                          {coluna === 'com_fit' && (
                            <Button size="sm" className="h-7 text-xs" disabled={agindo} onClick={() => setAgendando(l)}>
                              <CalendarPlus className="mr-1 h-3 w-3" aria-hidden /> Agendar
                            </Button>
                          )}
                          {coluna === 'reuniao_agendada' && (
                            <>
                              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={agindo}
                                onClick={() => void mover(l, 'reuniao_realizada')}>
                                Realizada
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={agindo}
                                onClick={() => void mover(l, 'no_show')}>
                                No-show
                              </Button>
                            </>
                          )}
                          {coluna === 'reuniao_realizada' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={agindo}
                              onClick={() => void mover(l, 'qualificada')}>
                              Qualificada <ChevronRight className="ml-0.5 h-3 w-3" aria-hidden />
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

      {/* ── Agendar ── */}
      <Dialog open={agendando !== null} onOpenChange={(v) => !v && setAgendando(null)}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!agendando) return
              const fd = new FormData(e.currentTarget)
              const quando = String(fd.get('quando') ?? '')
              const destino = String(fd.get('destino') ?? '')
              // datetime-local vem sem fuso; o banco quer ISO com offset.
              const iso = quando ? new Date(quando).toISOString() : ''
              const ok = await mover(agendando, 'reuniao_agendada', {
                reuniao_em: iso,
                vendedor_destino_id: destino,
              })
              if (ok) setAgendando(null)
            }}
          >
            <DialogHeader>
              <DialogTitle>Agendar reunião</DialogTitle>
              <DialogDescription>
                Cria o card no funil do closer e o evento no calendário dos dois. O closer vê a
                reunião como sua no mesmo instante.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="quando">Quando</Label>
                <Input id="quando" name="quando" type="datetime-local" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="destino">Vendedor destino</Label>
                <select
                  id="destino"
                  name="destino"
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione…</option>
                  {closers.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nome} · {TIPO_VENDEDOR_LABELS[v.tipo as TipoVendedorId] ?? v.tipo}
                    </option>
                  ))}
                </select>
                {closers.length === 0 && (
                  <p className="text-xs text-destructive">
                    Nenhum closer cadastrado — cadastre um vendedor em Configurações.
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAgendando(null)}>Cancelar</Button>
              <Button type="submit" disabled={agindo || closers.length === 0}>Agendar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Sem fit ── */}
      <Dialog open={semFit !== null} onOpenChange={(v) => !v && setSemFit(null)}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!semFit) return
              const motivo = String(new FormData(e.currentTarget).get('motivo') ?? '')
              const ok = await mover(semFit, 'sem_fit', { sem_fit_motivo: motivo })
              if (ok) setSemFit(null)
            }}
          >
            <DialogHeader>
              <DialogTitle>Marcar sem fit</DialogTitle>
              <DialogDescription>
                O motivo é obrigatório e vira estatística: é ele que diz se a régua do Mercado
                está trazendo empresa errada, e por qual razão.
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
              <Button type="button" variant="outline" onClick={() => setSemFit(null)}>Cancelar</Button>
              <Button type="submit" variant="destructive" disabled={agindo}>Marcar sem fit</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
