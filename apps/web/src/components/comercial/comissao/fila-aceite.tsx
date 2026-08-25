'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Clock, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { decidirAceiteSdrAction } from '@/actions/comercial'
import { buscarAceites, comissaoKeys, type AceitePendente } from '../queries-comissao'
import { dataHora } from './format'

/**
 * A fila de aceite (§5): reuniões esperando a confirmação de quem sentou nelas.
 *
 * O contador de SLA é o elemento central da tela, e ele conta para BAIXO até um aceite,
 * não até uma recusa. É a única forma honesta de mostrar a regra: o silêncio do vendedor
 * não é evidência de que a reunião não aconteceu, então passado o prazo ela conta como
 * aceita. Transferir esse risco ao SDR o faria pagar pela agenda do outro.
 *
 * Recusar exige motivo. Aceitar não exige nada — é a recusa que precisa ser explicada.
 */

function restante(prazo: string): { texto: string; urgente: boolean; vencido: boolean } {
  const ms = new Date(prazo).getTime() - Date.now()
  if (ms <= 0) return { texto: 'prazo vencido — conta como aceita', urgente: true, vencido: true }
  const horas = Math.floor(ms / 3_600_000)
  const minutos = Math.floor((ms % 3_600_000) / 60_000)
  return {
    texto: horas >= 1 ? `${horas}h${String(minutos).padStart(2, '0')} para decidir` : `${minutos} min para decidir`,
    urgente: horas < 6,
    vencido: false,
  }
}

function RecusaDialog({
  aceite, onOpenChange, onFeito,
}: {
  aceite: AceitePendente | null
  onOpenChange: (v: boolean) => void
  onFeito: () => void
}) {
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)

  return (
    <Dialog open={aceite !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!aceite) return
            const fd = new FormData(e.currentTarget)
            setSalvando(true)
            setErro(null)
            const r = await decidirAceiteSdrAction({
              aceite_id: aceite.id,
              decisao: 'recusada',
              motivo_recusa: String(fd.get('motivo') ?? ''),
            })
            setSalvando(false)
            if (!r.ok) return setErro(r.message)
            toast.success('Reunião recusada. Nenhuma comissão foi provisionada.')
            onOpenChange(false)
            onFeito()
          }}
        >
          <DialogHeader>
            <DialogTitle>Recusar a reunião</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <p className="text-sm text-muted-foreground">
              {aceite?.empresas?.razao_social ?? 'Empresa'} — recusar impede a comissão do
              SDR por esta reunião. O motivo fica no histórico.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="motivo">Motivo</Label>
              <Input id="motivo" name="motivo" required minLength={3}
                placeholder="Ex.: a reunião não aconteceu; o contato não compareceu." />
            </div>
          </div>
          {erro ? <p className="pb-2 text-sm text-destructive">{erro}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" variant="destructive" disabled={salvando}>
              {salvando ? 'Recusando…' : 'Recusar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function FilaAceite() {
  const qc = useQueryClient()
  const [recusando, setRecusando] = React.useState<AceitePendente | null>(null)
  const [agindo, setAgindo] = React.useState(false)

  const { data, isPending } = useQuery({
    queryKey: comissaoKeys.aceites(),
    queryFn: buscarAceites,
    // O contador tem de andar. Sem isto, "4h para decidir" fica na tela até o refresh.
    refetchInterval: 60_000,
  })

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['comercial', 'comissao-v2'] })
  }

  async function aceitar(a: AceitePendente) {
    setAgindo(true)
    const r = await decidirAceiteSdrAction({ aceite_id: a.id, decisao: 'aceita' })
    setAgindo(false)
    if (!r.ok) return toast.error(r.message)
    toast.success(
      r.data.enfileirado
        ? 'Reunião confirmada. A comissão do SDR foi provisionada.'
        : 'Reunião confirmada. O lançamento entra na próxima rodada horária.',
    )
    recarregar()
  }

  if (isPending) return <Skeleton className="h-64 w-full" />

  const todos = data ?? []
  const pendentes = todos.filter((a) => a.status === 'pendente')
  const decididos = todos.filter((a) => a.status !== 'pendente').slice(0, 20)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Aguardando confirmação</CardTitle>
          <CardDescription>
            Sem ação até o fim do prazo, a reunião conta como ACEITA — o silêncio de quem
            recebeu a reunião não pode custar a comissão de quem a marcou.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {pendentes.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nada esperando. Reunião marcada como realizada entra aqui na hora seguinte.
            </p>
          ) : (
            <ul className="divide-y">
              {pendentes.map((a) => {
                const sla = restante(a.prazo_em)
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-[14rem] flex-1">
                      <p className="text-sm font-medium">{a.empresas?.razao_social ?? 'Empresa'}</p>
                      <p className="text-xs text-muted-foreground">
                        Reunião em {dataHora(a.reuniao_em)} · na fila desde {dataHora(a.criado_em)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`gap-1 text-[10px] ${sla.urgente ? 'border-amber-500 text-amber-700 dark:text-amber-300' : ''}`}
                    >
                      <Clock className="h-3 w-3" aria-hidden /> {sla.texto}
                    </Badge>
                    <div className="flex items-center gap-2">
                      <Button size="sm" disabled={agindo} onClick={() => void aceitar(a)}>
                        <ThumbsUp className="mr-1 h-3.5 w-3.5" aria-hidden /> Aceitar
                      </Button>
                      <Button size="sm" variant="outline" disabled={agindo} onClick={() => setRecusando(a)}>
                        <ThumbsDown className="mr-1 h-3.5 w-3.5" aria-hidden /> Recusar
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {decididos.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Decididas recentemente</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y text-sm">
              {decididos.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                  <span>{a.empresas?.razao_social ?? 'Empresa'}</span>
                  <span className="flex items-center gap-2">
                    {a.status === 'recusada' ? (
                      <span className="text-xs text-muted-foreground">{a.motivo_recusa}</span>
                    ) : null}
                    <Badge
                      className={`text-[10px] ${
                        a.status === 'aceita'
                          ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200'
                          : 'bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200'
                      }`}
                    >
                      {a.status === 'aceita'
                        ? a.aceite_automatico ? 'aceita por prazo' : 'aceita'
                        : 'recusada'}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <RecusaDialog aceite={recusando} onOpenChange={(v) => !v && setRecusando(null)} onFeito={recarregar} />
    </div>
  )
}
