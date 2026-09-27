'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  COBRANCA_SITUACAO_TITULO_LABELS,
  diasEntreDatas,
  hojeSaoPaulo,
  type CobrancaSituacaoTitulo,
} from '@jobsiteos/core'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { quitarTituloAction, retirarTituloAction } from '@/actions/cobranca'
import { brl, cnpj, data } from './format'
import {
  buscarTitulosDaCobranca,
  cobrancaKeys,
  numeroDoTitulo,
  tituloAtivo,
  type CardCobranca,
  type TituloDaCobranca,
} from './queries'

/**
 * Os títulos da cobrança, com o snapshot da inclusão (§3: a produção pode mudar; o
 * dossiê não). A quitação manual existe porque a produção não informa a liquidação de
 * boleto trocado — quando o dinheiro chega por fora, é aqui que ele entra.
 */

const TOM_SITUACAO: Record<CobrancaSituacaoTitulo, BadgeProps['variant']> = {
  em_cobranca: 'warning',
  quitado: 'success',
  acordado: 'info',
  protestado: 'critical',
  sinistrado: 'critical',
  retirado: 'neutral',
}

export function AbaTitulos({ cobranca }: { cobranca: CardCobranca }) {
  const id = cobranca.id!
  const qc = useQueryClient()
  const titulos = useQuery({ queryKey: cobrancaKeys.titulos(id), queryFn: () => buscarTitulosDaCobranca(id) })
  const [quitando, setQuitando] = React.useState<TituloDaCobranca | null>(null)
  const hoje = hojeSaoPaulo()
  const rascunho = cobranca.estagio === 'rascunho'

  async function retirar(t: TituloDaCobranca) {
    const r = await retirarTituloAction(id, t.id)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Título retirado. As minutas em rascunho foram descartadas — gere-as de novo.')
    void qc.invalidateQueries({ queryKey: cobrancaKeys.all })
  }

  if (titulos.isPending) return <Skeleton className="h-64 w-full" />

  const lista = titulos.data ?? []
  const ativos = lista.filter(tituloAtivo)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">
          Títulos ({ativos.length} ativo(s) de {lista.length})
        </CardTitle>
        <span className="text-sm tabular-nums">
          em aberto {brl(ativos.reduce((s, t) => s + Number(t.valor_face_snapshot), 0))}
        </span>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título / NF</TableHead>
              <TableHead>SPE devedora</TableHead>
              <TableHead>Cedente</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Atraso hoje</TableHead>
              <TableHead className="text-right">Face</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((t) => {
              const situacao = t.situacao as CobrancaSituacaoTitulo
              return (
                <TableRow key={t.id}>
                  <TableCell className="text-sm">
                    {numeroDoTitulo(t)}
                    {t.titulos?.nf_chave_acesso ? (
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        NF {t.titulos.nf_chave_acesso.slice(25, 34)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="font-mono">{cnpj(t.sacado_cnpj_snapshot)}</span>
                    {t.sacado_cnpj_snapshot === cobranca.sacado_matriz_cnpj ? (
                      <span className="block text-[10px] text-muted-foreground">matriz</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate text-xs" title={t.titulos?.cedente_nome ?? undefined}>
                    {t.titulos?.cedente_nome ?? cnpj(t.cedente_cnpj_snapshot)}
                  </TableCell>
                  <TableCell className="text-xs">{data(t.vencimento_snapshot)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {Math.max(0, diasEntreDatas(t.vencimento_snapshot, hoje))} d
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{brl(t.valor_face_snapshot)}</TableCell>
                  <TableCell className="text-xs">
                    <Badge variant={TOM_SITUACAO[situacao] ?? 'outline'}>
                      {COBRANCA_SITUACAO_TITULO_LABELS[situacao] ?? t.situacao}
                    </Badge>
                    {t.situacao === 'quitado' ? (
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {brl(t.valor_recebido)} em {data(t.quitado_em)}
                        {t.quitado_origem === 'producao' ? ' (produção)' : ' (manual)'}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {tituloAtivo(t) ? (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setQuitando(t)}>
                        Quitar
                      </Button>
                    ) : null}
                    {rascunho && t.situacao === 'em_cobranca' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-1 h-7 text-xs"
                        onClick={() => void retirar(t)}
                        title="Só antes do primeiro envio. Depois, um título só sai por quitação."
                      >
                        Retirar
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {!rascunho ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Depois do primeiro envio, um título só sai da cobrança por quitação — retirar apagaria da carta
            enviada o que ela cobrou.
          </p>
        ) : null}
      </CardContent>
      <QuitarDialog cobrancaId={id} titulo={quitando} onFechar={() => setQuitando(null)} />
    </Card>
  )
}

function QuitarDialog({
  cobrancaId,
  titulo,
  onFechar,
}: {
  cobrancaId: string
  titulo: TituloDaCobranca | null
  onFechar: () => void
}) {
  const qc = useQueryClient()
  const [dataPg, setDataPg] = React.useState(hojeSaoPaulo())
  const [valor, setValor] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (titulo) {
      setDataPg(hojeSaoPaulo())
      setValor(String(titulo.valor_face_snapshot))
    }
  }, [titulo])

  async function quitar() {
    if (!titulo) return
    setSalvando(true)
    const v = Number(valor.replace(',', '.'))
    const r = await quitarTituloAction(cobrancaId, {
      id: titulo.id,
      quitado_em: dataPg,
      ...(Number.isFinite(v) && v > 0 ? { valor_recebido: v } : {}),
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Quitação registrada. Se este título tiver protesto, a instrução de retirada fica pendente na aba Protesto.')
    void qc.invalidateQueries({ queryKey: cobrancaKeys.all })
    onFechar()
  }

  return (
    <Dialog open={Boolean(titulo)} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar quitação</DialogTitle>
          <DialogDescription>
            Título {titulo ? numeroDoTitulo(titulo) : ''} — face {brl(titulo?.valor_face_snapshot)}. Use quando o
            pagamento não veio pela produção (boleto trocado, depósito, acordo pago por fora).
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="quit-data">Pago em</Label>
            <Input id="quit-data" type="date" value={dataPg} onChange={(e) => setDataPg(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="quit-valor">Valor recebido (R$)</Label>
            <Input id="quit-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvando || !dataPg} onClick={quitar}>
            Registrar quitação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
