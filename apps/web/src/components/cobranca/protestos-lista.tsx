'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Paperclip } from 'lucide-react'
import { PROTESTO_SITUACOES, PROTESTO_SITUACAO_LABELS, type ProtestoSituacao } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { buscarProtestos, gestaoKeys } from './gestao-queries'
import { abrirArquivo } from './sinistro-arquivos'
import { brl, data, dataHora } from './format'

/**
 * Protestos de todas as cobranças (§8), numa lista só. A ação — criar remessa, subir
 * retorno, instruir cancelamento — mora na cobrança, onde estão os títulos; aqui é o
 * panorama por situação e por UF (o convênio é estadual) e, acima de tudo, o que
 * ficou de pé depois de pago: protesto não retirado de título quitado vira dano moral
 * contra nós, e a linha aparece em vermelho até alguém instruir o cancelamento.
 */

const REMESSA_STATUS: Record<string, string> = {
  rascunho: 'Rascunho',
  enviada: 'Enviada',
  confirmada: 'Confirmada',
  rejeitada: 'Rejeitada',
}
const REMESSA_TIPO: Record<string, string> = {
  apresentacao: 'Apresentação',
  desistencia: 'Desistência',
  cancelamento: 'Cancelamento',
}

export function ProtestosLista() {
  const q = useQuery({ queryKey: gestaoKeys.protestos(), queryFn: buscarProtestos })
  const [situacao, setSituacao] = React.useState('todas')
  const [uf, setUf] = React.useState('todas')
  const [soRetirar, setSoRetirar] = React.useState(false)

  const titulos = React.useMemo(() => q.data?.titulos ?? [], [q.data])
  const ufs = React.useMemo(() => [...new Set(titulos.map((t) => t.uf).filter((x): x is string => !!x))].sort(), [titulos])
  const aRetirar = titulos.filter((t) => t.retirada_pendente)
  const filtrados = titulos.filter(
    (t) =>
      (situacao === 'todas' || t.situacao === situacao) &&
      (uf === 'todas' || t.uf === uf) &&
      (!soRetirar || t.retirada_pendente),
  )

  if (q.isLoading) return <Skeleton className="h-96 w-full" />

  return (
    <div className="space-y-4">
      {aRetirar.length > 0 ? (
        <div className="flex items-start gap-3 rounded-md border border-destructive bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
          <p>
            <strong>{aRetirar.length} protesto(s) de título já quitado sem instrução de cancelamento.</strong> Protesto
            não retirado depois do pagamento vira dano moral contra nós — instrua o cancelamento na cobrança.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Select value={situacao} onValueChange={setSituacao}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as situações</SelectItem>
            {PROTESTO_SITUACOES.map((s) => (
              <SelectItem key={s} value={s}>
                {PROTESTO_SITUACAO_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={uf} onValueChange={setUf}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as UFs</SelectItem>
            {ufs.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="so-retirar" checked={soRetirar} onCheckedChange={setSoRetirar} />
          <Label htmlFor="so-retirar" className="font-normal">
            Só cancelamento pendente
          </Label>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Títulos protestados ({filtrados.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cobrança</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Cartório</TableHead>
                <TableHead>UF / CRA</TableHead>
                <TableHead>Protesto</TableHead>
                <TableHead className="text-right">Custas</TableHead>
                <TableHead>Cancelamento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.map((t) => (
                <TableRow key={t.id} className={cn(t.retirada_pendente && 'bg-red-50 dark:bg-red-950/40')}>
                  <TableCell>
                    {t.cobranca_id ? (
                      <Link href={`/cobranca/cobrancas/${t.cobranca_id}`} className="font-medium text-primary hover:underline">
                        {t.cobranca_codigo ?? 'Cobrança'}
                      </Link>
                    ) : (
                      '—'
                    )}
                    <div className="text-[11px] text-muted-foreground">{t.sacado_razao_social ?? ''}</div>
                  </TableCell>
                  <TableCell>
                    <div>{t.titulo_numero ?? '—'}</div>
                    <div className="text-[11px] tabular-nums text-muted-foreground">
                      {brl(t.valor_face)}
                      {t.cobranca_titulo_situacao === 'quitado' ? ' · quitado' : ''}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.situacao === 'protestado' ? 'critical' : t.situacao === 'rejeitado' ? 'warning' : 'neutral'}>
                      {PROTESTO_SITUACAO_LABELS[t.situacao as ProtestoSituacao] ?? t.situacao}
                    </Badge>
                    {t.motivo_rejeicao ? <div className="text-[11px] text-muted-foreground">{t.motivo_rejeicao}</div> : null}
                  </TableCell>
                  <TableCell>
                    <div>{t.cartorio ?? '—'}</div>
                    {t.protocolo_cartorio ? <div className="text-[11px] text-muted-foreground">prot. {t.protocolo_cartorio}</div> : null}
                  </TableCell>
                  <TableCell>
                    {t.uf ?? '—'}
                    <div className="text-[11px] text-muted-foreground">{t.cra ?? ''}</div>
                  </TableCell>
                  <TableCell>
                    {data(t.data_protesto)}
                    {t.certidao_path ? (
                      <button
                        type="button"
                        className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                        onClick={() => void abrirArquivo(t.certidao_path!)}
                      >
                        <Paperclip className="h-3 w-3" aria-hidden />
                        certidão
                      </button>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{brl(t.custas)}</TableCell>
                  <TableCell className="text-xs">
                    {t.instrucao_cancelamento_em ? (
                      <span>instruído em {dataHora(t.instrucao_cancelamento_em)}</span>
                    ) : t.instrucao_nao_aplicavel_motivo ? (
                      <span className="text-muted-foreground">não aplicável: {t.instrucao_nao_aplicavel_motivo}</span>
                    ) : t.retirada_pendente ? (
                      <span className="font-medium text-destructive">pendente</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtrados.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                    Nenhum título protestado neste filtro.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Remessas ({q.data?.remessas.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cobrança</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>UF / CRA</TableHead>
                <TableHead>Modo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Protocolo</TableHead>
                <TableHead>Enviada</TableHead>
                <TableHead className="text-right">Títulos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data?.remessas ?? [])
                .filter((r) => uf === 'todas' || r.uf === uf)
                .map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.cobranca_id ? (
                        <Link href={`/cobranca/cobrancas/${r.cobranca_id}`} className="text-primary hover:underline">
                          {r.cobranca_codigo ?? 'Cobrança'}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{REMESSA_TIPO[r.tipo] ?? r.tipo}</TableCell>
                    <TableCell>
                      {r.uf} · {r.cra}
                    </TableCell>
                    <TableCell>{r.modo === 'api' ? 'API' : 'Portal (manual)'}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'rejeitada' ? 'critical' : r.status === 'rascunho' ? 'neutral' : 'info'}>
                        {REMESSA_STATUS[r.status] ?? r.status}
                      </Badge>
                      {r.retorno_processado_em ? (
                        <div className="text-[11px] text-muted-foreground">retorno {dataHora(r.retorno_processado_em)}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>{r.protocolo ?? '—'}</TableCell>
                    <TableCell>{dataHora(r.enviada_em)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.qtd_titulos}</TableCell>
                  </TableRow>
                ))}
              {(q.data?.remessas.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhuma remessa de protesto ainda. Remessas nascem na cobrança, a partir dos títulos dela.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
