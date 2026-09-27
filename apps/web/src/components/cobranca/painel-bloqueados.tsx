'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Lock } from 'lucide-react'
import { PROTESTO_SITUACAO_LABELS, type ProtestoSituacao } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import { regularizarSacadoAction, type ResultadoRegularizacao } from '@/actions/cobranca-gestao'
import { buscarBloqueados, gestaoKeys, type GrupoBloqueado } from './gestao-queries'
import { brl, cnpj, data, dataHora, estagioLabel } from './format'

/**
 * Sacados bloqueados (§11). O bloqueio é de GRUPO e nasce do envio da notificação; ele
 * só sai por um ato humano do gestor, e só quando TODOS os títulos de TODAS as
 * cobranças do grupo estão quitados. Quitação parcial mantém o bloqueio e mostra o
 * saldo — é o que o operador precisa dizer ao comercial quando perguntarem "já pode?".
 *
 * Protesto de pé sem instrução de cancelamento também segura a regularização: título
 * pago com protesto não retirado vira dano moral contra nós (§8).
 */
export function SacadosBloqueados({ gestor }: { gestor: boolean }) {
  const q = useQuery({ queryKey: gestaoKeys.bloqueados(), queryFn: buscarBloqueados })
  const [alvo, setAlvo] = React.useState<GrupoBloqueado | null>(null)
  const [resultado, setResultado] = React.useState<(ResultadoRegularizacao & { nome: string | null }) | null>(null)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4" aria-hidden />
          Sacados bloqueados
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {resultado ? <ResultadoCard r={resultado} onFechar={() => setResultado(null)} /> : null}

        {q.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !q.data?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhum grupo bloqueado por cobrança.</p>
        ) : (
          q.data.map((g) => {
            const quitado = g.pendentes === 0 && g.titulos.length > 0
            const podeRegularizar = quitado && g.protestos_a_retirar.length === 0
            return (
              <div key={g.sacado_matriz_cnpj} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {g.empresa_id ? (
                        <Link href={`/empresas/${g.empresa_id}`} className="hover:underline">
                          {g.razao_social ?? 'Sacado'}
                        </Link>
                      ) : (
                        (g.razao_social ?? 'Sacado')
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{cnpj(g.sacado_matriz_cnpj)}</span> · bloqueado desde {dataHora(g.desde)} ·{' '}
                      {g.cnpjs.length} CNPJ(s) no grupo
                    </div>
                  </div>
                  {quitado ? (
                    <Badge variant="success">todos os títulos quitados</Badge>
                  ) : (
                    <Badge variant="critical">
                      {g.pendentes} título(s) em aberto · saldo {brl(g.saldo_pendente)}
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  {g.cobrancas.map((c) => (
                    <Link
                      key={c.id}
                      href={`/cobranca/cobrancas/${c.id}`}
                      className="rounded border border-border px-2 py-0.5 hover:bg-accent"
                    >
                      {c.codigo} · {estagioLabel(c.estagio)} · {c.qtd_ativos ?? 0}/{c.qtd_titulos ?? 0} ativos
                    </Link>
                  ))}
                </div>

                {g.protestos_a_retirar.length > 0 ? (
                  <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                    <p className="font-medium">
                      {g.protestos_a_retirar.length} protesto(s) sem instrução de cancelamento — a regularização fica
                      bloqueada até cada um ser retirado ou marcado como não aplicável.
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {g.protestos_a_retirar.map((p) => (
                        <li key={p.id}>
                          {PROTESTO_SITUACAO_LABELS[p.situacao as ProtestoSituacao] ?? p.situacao} · {p.cartorio ?? 'cartório —'}{' '}
                          ({p.uf}){' '}
                          {p.cobranca_id ? (
                            <Link href={`/cobranca/cobrancas/${p.cobranca_id}`} className="underline">
                              abrir cobrança
                            </Link>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {quitado ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      Recebido {brl(g.total_recebido)} · último pagamento em {data(g.ultimo_pagamento)}
                    </span>
                    {gestor ? (
                      <Button size="sm" disabled={!podeRegularizar} onClick={() => setAlvo(g)}>
                        Regularizar sacado
                      </Button>
                    ) : (
                      <span>A regularização é feita pela gestão de cobrança.</span>
                    )}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </CardContent>

      <DialogRegularizar
        alvo={alvo}
        onFechar={() => setAlvo(null)}
        onFeito={(r) => {
          setResultado({ ...r, nome: alvo?.razao_social ?? null })
          setAlvo(null)
        }}
      />
    </Card>
  )
}

function DialogRegularizar({
  alvo,
  onFechar,
  onFeito,
}: {
  alvo: GrupoBloqueado | null
  onFechar: () => void
  onFeito: (r: ResultadoRegularizacao) => void
}) {
  const qc = useQueryClient()
  const [enviando, setEnviando] = React.useState(false)
  const quitados = (alvo?.titulos ?? []).filter((t) => t.situacao === 'quitado')

  async function confirmar() {
    if (!alvo) return
    setEnviando(true)
    const r = await regularizarSacadoAction(alvo.sacado_matriz_cnpj)
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Sacado regularizado.')
    void qc.invalidateQueries({ queryKey: gestaoKeys.all })
    onFeito(r.data)
  }

  return (
    <Dialog open={alvo !== null} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Regularizar {alvo?.razao_social ?? 'sacado'}</DialogTitle>
          <DialogDescription>
            Remove o bloqueio de cobrança do grupo inteiro ({alvo?.cnpjs.length ?? 0} CNPJ(s)) e encerra os prazos de
            apólice dos títulos pagos.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="max-h-48 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">Pago em</th>
                  <th className="px-2 py-1 text-right font-medium">Face</th>
                  <th className="px-2 py-1 text-right font-medium">Recebido</th>
                </tr>
              </thead>
              <tbody>
                {quitados.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-2 py-1">{data(t.quitado_em)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{brl(t.valor_face_snapshot)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{brl(t.valor_recebido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Total recebido <strong>{brl(alvo?.total_recebido)}</strong>; último pagamento em{' '}
            <strong>{data(alvo?.ultimo_pagamento)}</strong>.
          </p>
          <p className="text-muted-foreground">
            Colocar em cobrança interrompeu a cobertura (cl. 17700.20 b): ela volta a valer só para recebíveis cedidos a
            partir da data do pagamento, sem efeito retroativo. O limite de crédito não volta sozinho — fica em revisão
            pós-inadimplência na esteira, salvo se a configuração de regularização disser o contrário.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => void confirmar()} disabled={enviando}>
            {enviando ? 'Regularizando…' : 'Confirmar regularização'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResultadoCard({
  r,
  onFechar,
}: {
  r: ResultadoRegularizacao & { nome: string | null }
  onFechar: () => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="flex-1 space-y-1">
        <p className="font-semibold">{r.nome ?? cnpj(r.sacado_matriz_cnpj)} regularizado.</p>
        <p>
          Cobertura volta a valer para recebíveis cedidos a partir de{' '}
          <strong>{data(r.cobertura_volta_em ?? r.pago_em)}</strong> · {r.prazos_encerrados} prazo(s) de apólice
          encerrado(s).
        </p>
        <p>
          {r.revisao_pos_inadimplencia
            ? 'O limite de crédito ficou em revisão pós-inadimplência: a próxima decisão da esteira é uma revisão, não uma restauração automática.'
            : 'O limite foi restaurado automaticamente (configuração de regularização).'}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onFechar}>
        Fechar
      </Button>
    </div>
  )
}
