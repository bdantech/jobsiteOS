'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, History } from 'lucide-react'
import {
  FASE_CONTA_LABELS,
  GESTAO_OPERACAO_LABELS,
  GESTOES_OPERACAO,
  determinarFase,
  idadeEmMeses,
  sugereRevisao,
  valorParametro,
  type CommissionParam,
  type GestaoOperacao,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { definirGestaoAction } from '@/actions/comercial'
import {
  buscarHistoricoGestao,
  buscarParametros,
  buscarReclassificacao,
  comissaoKeys,
  vigentesHoje,
  type ContaParaRevisar,
} from '../queries-comissao'
import { brlCurto, data as fmtData, dataHora, numero } from './format'

/**
 * O painel de reclassificação (§7.6).
 *
 * Duas coisas que a tela precisa dizer ao mesmo tempo, e que são fáceis de confundir:
 *
 *   O SINALIZADOR NÃO É UMA DECISÃO. Volume abaixo do piso significa "vale olhar", não
 *   "reclassifique". O número não sabe se a obra parou, se o sacado trocou de banco ou se
 *   ninguém registrou nada.
 *
 *   A MUDANÇA VALE A PARTIR DE AMANHÃ. O que já converteu guarda a classificação do dia
 *   em que converteu, no próprio lançamento. Reclassificar não reprecifica o passado — e
 *   também não reinicia o relógio da conta.
 */

function TrocarDialog({
  conta, onOpenChange, onFeito,
}: {
  conta: ContaParaRevisar | null
  onOpenChange: (v: boolean) => void
  onFeito: () => void
}) {
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const atual = (conta?.gestao_operacao ?? null) as GestaoOperacao | null
  const [escolha, setEscolha] = React.useState<GestaoOperacao>('passivo')

  React.useEffect(() => {
    if (conta) setEscolha(atual === 'passivo' ? 'prospeccao_ativa' : 'passivo')
  }, [conta, atual])

  return (
    <Dialog open={conta !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!conta) return
            const fd = new FormData(e.currentTarget)
            setSalvando(true)
            setErro(null)
            const r = await definirGestaoAction({
              empresa_id: conta.empresa_id,
              gestao_operacao: escolha,
              motivo: String(fd.get('motivo') ?? ''),
            })
            setSalvando(false)
            if (!r.ok) return setErro(r.message)
            toast.success('Classificação alterada. Vale a partir de amanhã; o passado não muda.')
            onOpenChange(false)
            onFeito()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {atual ? 'Reclassificar' : 'Classificar'} {conta?.razao_social ?? 'a conta'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="nova-gestao">Nova classificação</Label>
              <select
                id="nova-gestao"
                value={escolha}
                onChange={(e) => setEscolha(e.target.value as GestaoOperacao)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {GESTOES_OPERACAO.map((g) => (
                  <option key={g} value={g}>{GESTAO_OPERACAO_LABELS[g]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="motivo-gestao">Motivo (obrigatório)</Label>
              <Input id="motivo-gestao" name="motivo" required minLength={3}
                placeholder="Ex.: a conta voltou a exigir trabalho ativo depois da troca de comprador." />
              <p className="text-xs text-muted-foreground">
                {atual
                  ? 'A mudança vale a partir do dia seguinte. Cessões já convertidas mantêm a classificação da data em que converteram, e o relógio da conta NÃO reinicia.'
                  : 'Vale a partir do dia seguinte. As cessões que já converteram sem classificação não são reprocessadas — o motor não reescreve o passado, e classificar hoje não paga o que passou.'}
              </p>
            </div>
          </div>
          {erro ? <p className="pb-2 text-sm text-destructive">{erro}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Reclassificar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function HistoricoDialog({
  empresaId, nome, onOpenChange,
}: {
  empresaId: string | null
  nome: string | null
  onOpenChange: (v: boolean) => void
}) {
  const { data, isPending } = useQuery({
    queryKey: ['comercial', 'comissao-v2', 'historico-gestao', empresaId],
    queryFn: () => buscarHistoricoGestao(empresaId as string),
    enabled: empresaId !== null,
  })

  return (
    <Dialog open={empresaId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Histórico de classificação — {nome ?? 'conta'}</DialogTitle>
        </DialogHeader>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : (data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma mudança registrada. A classificação atual é a original.
          </p>
        ) : (
          <ul className="max-h-96 space-y-3 overflow-y-auto text-sm">
            {(data ?? []).map((h) => (
              <li key={h.id} className="rounded-md border p-3">
                <p className="flex flex-wrap items-baseline gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {h.valor_anterior
                      ? GESTAO_OPERACAO_LABELS[h.valor_anterior as GestaoOperacao] ?? h.valor_anterior
                      : 'não definido'}
                  </Badge>
                  →
                  <Badge className="text-[10px]">
                    {GESTAO_OPERACAO_LABELS[h.valor_novo as GestaoOperacao] ?? h.valor_novo}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{dataHora(h.alterado_em)}</span>
                </p>
                <p className="mt-1 text-muted-foreground">{h.motivo}</p>
                {h.usuarios?.nome ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">por {h.usuarios.nome}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function Reclassificacao() {
  const qc = useQueryClient()
  const [trocando, setTrocando] = React.useState<ContaParaRevisar | null>(null)
  const [vendoHistorico, setVendoHistorico] = React.useState<ContaParaRevisar | null>(null)

  const params = useQuery({ queryKey: comissaoKeys.parametros(), queryFn: buscarParametros })
  const vigentes: CommissionParam[] = vigentesHoje(params.data ?? []).filter((p) => p.vendedor_id === null)
  const hoje = new Date()
  const janela = valorParametro(vigentes, 'alerta_revisao_dias', null, hoje) ?? 45
  const piso = valorParametro(vigentes, 'alerta_revisao_percentual', null, hoje) ?? 50

  const { data, isPending } = useQuery({
    queryKey: comissaoKeys.reclassificacao(janela),
    queryFn: () => buscarReclassificacao(janela),
    enabled: !params.isPending,
  })

  if (isPending || params.isPending) return <Skeleton className="h-96 w-full" />

  const contas = (data?.contas ?? []).map((c) => {
    const gestao = (c.gestao_operacao ?? null) as GestaoOperacao | null
    const idade = c.marco_ativacao ? idadeEmMeses(c.marco_ativacao, hoje) : null
    const fase = gestao
      ? determinarFase({
          marcoAtivacao: c.marco_ativacao,
          gestaoOperacao: gestao,
          data: hoje,
          mesesCrescimento: valorParametro(
            vigentes,
            gestao === 'passivo' ? 'fase_crescimento_passivo_meses' : 'fase_crescimento_prospeccao_ativa_meses',
            null,
            hoje,
          ),
          mesesSunset: valorParametro(
            vigentes,
            gestao === 'passivo'
              ? 'sunset_vendedor_passivo_meses'
              : 'sunset_vendedor_prospeccao_ativa_meses',
            null,
            hoje,
          ),
        })
      : null
    return {
      ...c,
      idade,
      fase,
      // Conta sem classificação NÃO gera lançamento nenhum — nem para o vendedor, nem
      // para o originador. É a pendência mais cara desta tela, e por isso é uma coluna.
      semClassificacao: gestao === null,
      sinalizada: sugereRevisao({
        gestaoOperacao: gestao,
        volumeJanela: c.volume_janela,
        mediaMensalAnterior: c.media_mensal_anterior,
        percentualPiso: piso,
      }),
    }
  })
  /*
   * A ordem é a ordem do trabalho: primeiro quem opera SEM classificação (cada cessão
   * dessas passa sem pagar ninguém), depois a passiva sinalizada, depois o resto por
   * volume. Ordenar por volume puro deixaria a conta não classificada perdida no meio.
   */
  const prioridade = (c: { semClassificacao: boolean; sinalizada: boolean; volume_janela: number }) =>
    c.semClassificacao && c.volume_janela > 0 ? 0 : c.sinalizada ? 1 : c.semClassificacao ? 2 : 3
  contas.sort((a, b) => prioridade(a) - prioridade(b) || b.volume_janela - a.volume_janela)
  const sinalizadas = contas.filter((c) => c.sinalizada).length
  const semClassificacaoOperando = contas.filter((c) => c.semClassificacao && c.volume_janela > 0).length

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Classificação das contas</CardTitle>
              <CardDescription>
                Conta SEM classificação não gera lançamento nenhum — nem para o vendedor,
                nem para o originador. Sinalizamos também a conta passiva cujo volume dos
                últimos {numero(janela)} dias ficou abaixo de {numero(piso)}% da média dos
                três meses anteriores; isso é um sinalizador, e o sistema nunca reclassifica
                sozinho.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {semClassificacaoOperando > 0 ? (
                <Badge variant="outline" className="gap-1 border-destructive text-destructive">
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  {semClassificacaoOperando} operando sem classificação
                </Badge>
              ) : null}
              {sinalizadas > 0 ? (
                <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3 w-3" aria-hidden /> {sinalizadas} para revisar
                </Badge>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {contas.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma conta classificada ainda. A pergunta ativo × passivo só existe para
              cliente ou ex-cliente.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-normal">Conta</th>
                    <th scope="col" className="px-3 py-2 font-normal">Classificação</th>
                    <th scope="col" className="px-3 py-2 font-normal">Titular</th>
                    <th scope="col" className="px-3 py-2 font-normal">Idade / fase</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">
                      Volume {numero(janela)}d
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Média 3 meses</th>
                    <th scope="col" className="w-40 px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {contas.map((c) => (
                    <tr
                      key={c.empresa_id}
                      className={
                        c.semClassificacao && c.volume_janela > 0
                          ? 'bg-destructive/5'
                          : c.sinalizada
                            ? 'bg-amber-50/60 dark:bg-amber-500/5'
                            : ''
                      }
                    >
                      <td className="px-3 py-2">
                        <span className="block font-medium">{c.razao_social ?? c.cnpj}</span>
                        {c.semClassificacao && c.volume_janela > 0 ? (
                          <span className="flex items-center gap-1 text-xs text-destructive">
                            <AlertTriangle className="h-3 w-3" aria-hidden />
                            está operando e nenhuma cessão dela paga comissão
                          </span>
                        ) : c.sinalizada ? (
                          <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="h-3 w-3" aria-hidden /> volume caiu — vale revisar
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {c.semClassificacao ? (
                          <Badge variant="outline" className="text-[10px]">não definida</Badge>
                        ) : (
                          <Badge variant={c.gestao_operacao === 'passivo' ? 'secondary' : 'default'} className="text-[10px]">
                            {GESTAO_OPERACAO_LABELS[c.gestao_operacao as GestaoOperacao] ?? '—'}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.titular ?? 'sem titular'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {c.idade === null ? (
                          'sem marco de ativação'
                        ) : (
                          <>
                            {numero(c.idade)} mes(es) · {c.fase ? FASE_CONTA_LABELS[c.fase] : '—'}
                            <span className="block">desde {fmtData(c.marco_ativacao)}</span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{brlCurto(c.volume_janela)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {brlCurto(c.media_mensal_anterior)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => setVendoHistorico(c)}>
                          <History className="mr-1 h-3 w-3" aria-hidden /> {numero(c.mudancas)}
                        </Button>
                        <Button size="sm" variant={c.semClassificacao ? 'default' : 'outline'} className="h-7 text-xs"
                          onClick={() => setTrocando(c)}>
                          {c.semClassificacao ? 'Classificar' : 'Reclassificar'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <TrocarDialog
        conta={trocando}
        onOpenChange={(v) => !v && setTrocando(null)}
        onFeito={() => void qc.invalidateQueries({ queryKey: ['comercial'] })}
      />
      <HistoricoDialog
        empresaId={vendoHistorico?.empresa_id ?? null}
        nome={vendoHistorico?.razao_social ?? null}
        onOpenChange={(v) => !v && setVendoHistorico(null)}
      />
    </div>
  )
}
