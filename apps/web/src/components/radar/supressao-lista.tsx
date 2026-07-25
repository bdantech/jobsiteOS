'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ESCOPOS_SUPRESSAO,
  ESCOPO_SUPRESSAO_LABELS,
  MOTIVOS_SUPRESSAO,
  MOTIVO_SUPRESSAO_LABELS,
  type EscopoSupressao,
  type MotivoSupressao,
} from '@jobsiteos/core'
import { removerSupressaoAction, suprimirAction } from '@/actions/radar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarSupressao, radarKeys } from './queries'

export function SupressaoLista() {
  const qc = useQueryClient()
  const lista = useQuery({ queryKey: radarKeys.supressao(), queryFn: buscarSupressao })

  const [escopo, setEscopo] = React.useState<EscopoSupressao>('email')
  const [valor, setValor] = React.useState('')
  const [motivo, setMotivo] = React.useState<MotivoSupressao>('descadastro')
  const [obs, setObs] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  async function adicionar() {
    if (!valor.trim()) {
      toast.error('Informe o valor a suprimir.')
      return
    }
    setSalvando(true)
    const r = await suprimirAction({ escopo, valor: valor.trim(), motivo, observacao: obs.trim() || undefined })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Adicionado à supressão.')
    setValor('')
    setObs('')
    void qc.invalidateQueries({ queryKey: radarKeys.supressao() })
  }

  async function remover(id: string) {
    const r = await removerSupressaoAction(id)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Removido.')
    void qc.invalidateQueries({ queryKey: radarKeys.supressao() })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Lista de supressão</h1>
        <p className="text-muted-foreground">Consultada antes de qualquer toque, em qualquer canal.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Adicionar</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <Select value={escopo} onValueChange={(v) => setEscopo(v as EscopoSupressao)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ESCOPOS_SUPRESSAO.map((e) => (
                <SelectItem key={e} value={e}>
                  {ESCOPO_SUPRESSAO_LABELS[e]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="e-mail, telefone ou CNPJ" />
          <Select value={motivo} onValueChange={(v) => setMotivo(v as MotivoSupressao)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOTIVOS_SUPRESSAO.map((m) => (
                <SelectItem key={m} value={m}>
                  {MOTIVO_SUPRESSAO_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)" />
            <Button onClick={adicionar} disabled={salvando}>
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {lista.isPending ? (
            <Skeleton className="m-4 h-32" />
          ) : (lista.data ?? []).length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nada suprimido.</p>
          ) : (
            <div className="divide-y divide-border">
              {(lista.data ?? []).map((s) => (
                <div key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.valor}</p>
                    <p className="text-xs text-muted-foreground">
                      {ESCOPO_SUPRESSAO_LABELS[s.escopo as EscopoSupressao] ?? s.escopo} ·{' '}
                      {MOTIVO_SUPRESSAO_LABELS[s.motivo as MotivoSupressao] ?? s.motivo}
                      {s.observacao ? ` · ${s.observacao}` : ''}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => remover(s.id)}>
                    Remover
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
