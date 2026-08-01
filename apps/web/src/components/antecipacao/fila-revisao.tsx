'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Ban, Check, X } from 'lucide-react'
import { FAIXA_LABELS, type Faixa } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { casarAntecipacaoAction } from '@/actions/antecipacao'
import { FAIXA_BADGE, formatarData, formatarMoedaExata } from './format'
import { antecipacaoKeys, buscarCandidatas, type CandidataNota } from './queries'

/**
 * A fila de revisão (04e §6): a antecipação de um lado, as notas candidatas do
 * outro, e duas saídas — casar com esta, ou ignorar com motivo.
 *
 * As candidatas vêm do RPC, que recorta pelo MESMO par fornecedor↔sacado que o
 * motor automático usa. Isso é deliberado: o par é a única guarda que o
 * casamento não negocia, e uma tela que oferecesse notas de fora dele
 * convidaria a pessoa a cometer, no clique, o erro que a automação se recusa a
 * cometer.
 *
 * Cada linha mostra por que ela está ali — número idêntico, número parecido,
 * valor compatível — para que a decisão seja de leitura, não de investigação.
 */

const PROXIMIDADE_LABEL: Record<string, string> = {
  '0': 'Número idêntico',
  '1': 'Número parecido',
  '2': 'Valor compatível',
  '3': 'Mesmo par, sem semelhança',
}

const PROXIMIDADE_BADGE: Record<string, string> = {
  '0': 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  '1': 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200',
  '2': 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  '3': 'bg-muted text-muted-foreground',
}

export function FilaRevisao({
  idExterno,
  onFechar,
  onResolvida,
}: {
  idExterno: number
  onFechar: () => void
  onResolvida: () => void
}) {
  const [ignorando, setIgnorando] = React.useState(false)
  const [salvando, setSalvando] = React.useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: antecipacaoKeys.candidatas(idExterno),
    queryFn: () => buscarCandidatas(idExterno),
  })

  async function casar(accessKey: string) {
    setSalvando(accessKey)
    const r = await casarAntecipacaoAction({ id_externo: idExterno, acao: 'casar', access_key: accessKey })
    setSalvando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      r.data.convertida_em
        ? 'Casada e nota marcada como convertida.'
        : 'Casada. A nota não foi convertida porque o status desta antecipação não converte.',
    )
    onResolvida()
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  const candidatas = data?.candidatas ?? []

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {candidatas.length === 0
            ? 'Nenhuma nota deste fornecedor contra este sacado'
            : `${candidatas.length} nota${candidatas.length > 1 ? 's' : ''} do mesmo par`}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setIgnorando(true)}>
            <Ban className="mr-2 h-4 w-4" aria-hidden />
            Ignorar
          </Button>
          <Button size="sm" variant="ghost" onClick={onFechar}>
            <X className="h-4 w-4" aria-hidden />
            <span className="sr-only">Fechar</span>
          </Button>
        </div>
      </div>

      {candidatas.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          A NF pode não ter chegado no sync ainda, ou pode ter sido emitida contra outro CNPJ do
          grupo. Só é possível casar com notas do mesmo par fornecedor↔sacado — se a nota certa
          estiver sob outro CNPJ, o caminho é ignorar aqui e registrar o motivo.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {candidatas.map((c) => (
            <LinhaCandidata
              key={c.access_key}
              candidata={c}
              salvando={salvando === c.access_key}
              onCasar={() => void casar(c.access_key)}
            />
          ))}
        </ul>
      )}

      <DialogIgnorar
        aberto={ignorando}
        onOpenChange={setIgnorando}
        idExterno={idExterno}
        onResolvida={onResolvida}
      />
    </div>
  )
}

function LinhaCandidata({
  candidata: c,
  salvando,
  onCasar,
}: {
  candidata: CandidataNota
  salvando: boolean
  onCasar: () => void
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-2">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium tabular-nums">
            NF {c.numero ?? '—'}
            {c.serie ? `/${c.serie}` : ''}
          </span>
          <Badge className={PROXIMIDADE_BADGE[c.proximidade] ?? 'bg-muted'}>
            {PROXIMIDADE_LABEL[c.proximidade] ?? '—'}
          </Badge>
          {c.faixa && (
            <Badge className={FAIXA_BADGE[c.faixa as Faixa]}>{FAIXA_LABELS[c.faixa as Faixa]}</Badge>
          )}
          {c.ja_casada && (
            // Casar de novo é legítimo (a primeira pode ter sido um engano), mas
            // não pode acontecer sem que a pessoa saiba que está desfazendo algo.
            <Badge variant="outline" className="text-amber-700 dark:text-amber-300">
              já casada com outra antecipação
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatarMoedaExata(c.valor)} · emitida {formatarData(c.emitida_em)} · vence{' '}
          {formatarData(c.vencimento)} · {c.estagio_funil}
        </p>
      </div>
      <Button size="sm" onClick={onCasar} disabled={salvando}>
        <Check className="mr-2 h-4 w-4" aria-hidden />
        Casar com esta
      </Button>
    </li>
  )
}

function DialogIgnorar({
  aberto,
  onOpenChange,
  idExterno,
  onResolvida,
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  idExterno: number
  onResolvida: () => void
}) {
  const [motivo, setMotivo] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  async function confirmar() {
    setSalvando(true)
    const r = await casarAntecipacaoAction({ id_externo: idExterno, acao: 'ignorar', motivo })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Antecipação retirada da fila.')
    onOpenChange(false)
    setMotivo('')
    onResolvida()
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ignorar a antecipação #{idExterno}</DialogTitle>
          <DialogDescription>
            Ela sai da fila e nenhuma nota é convertida. O motivo é obrigatório — é o que torna a
            fila auditável depois, quando alguém perguntar por que esta antecipação nunca contou.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="motivo-ignorar">Motivo</Label>
          <Textarea
            id="motivo-ignorar"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: NF emitida contra outro CNPJ do grupo; operação cancelada na origem."
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void confirmar()} disabled={salvando || motivo.trim().length === 0}>
            Ignorar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
