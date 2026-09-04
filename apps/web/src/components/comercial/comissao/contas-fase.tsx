'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarClock, History, Pencil } from 'lucide-react'
import {
  FASE_CONTA_DESCRICOES,
  FASE_CONTA_LABELS,
  GESTAO_OPERACAO_LABELS,
  determinarFase,
  idadeEmMeses,
  valorParametro,
  type CommissionParam,
  type FaseConta,
  type GestaoOperacao,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ajustarFaseContaAction } from '@/actions/comercial'
import {
  buscarContasFase,
  buscarHistoricoFase,
  buscarParametros,
  comissaoKeys,
  vigentesHoje,
  type ContaFase,
} from '../queries-comissao'
import { brlCurto, data as fmtData, dataHora } from './format'

/**
 * O relógio de cada conta (04k §3).
 *
 * A fase decide a taxa — crescimento paga 1000 R$/MM em conta ativa contra 600 de
 * manutenção — e até aqui ela era 100% derivada da data da primeira cessão convertida,
 * sem ninguém poder tocá-la. Duas coisas quebravam nisso: o marco pode estar errado (ele é
 * gravado pela primeira cessão que o motor VÊ, e o motor nem sempre viu tudo), e o marco
 * pode estar certo com o julgamento sendo outro — uma conta nova para nós e madura na
 * relação.
 *
 * A fase derivada é mostrada SEMPRE, ao lado da fixada, mesmo quando a fixada vence. Uma
 * tela que só mostra o resultado esconde a discordância, e é a discordância que alguém
 * precisa revisar seis meses depois.
 *
 * O sunset não é editável de propósito: passar dele é o FIM do direito do vendedor sobre a
 * conta, não uma fase mais barata. Uma tag que sobrepusesse o sunset criaria uma exceção
 * permanente e invisível.
 */

function faseDerivada(conta: ContaFase, params: CommissionParam[]): FaseConta | null {
  const gestao = conta.gestao_operacao as GestaoOperacao | null
  if (!gestao) return null
  const hoje = new Date()
  const crescimento = valorParametro(
    params,
    gestao === 'passivo' ? 'fase_crescimento_passivo_meses' : 'fase_crescimento_prospeccao_ativa_meses',
    null,
    hoje,
  )
  const sunset = valorParametro(
    params,
    gestao === 'passivo' ? 'sunset_vendedor_passivo_meses' : 'sunset_vendedor_prospeccao_ativa_meses',
    null,
    hoje,
  )
  return determinarFase({
    marcoAtivacao: conta.marco_ativacao,
    gestaoOperacao: gestao,
    data: hoje,
    mesesCrescimento: crescimento,
    mesesSunset: sunset,
  })
}

function Historico({ empresaId }: { empresaId: string }) {
  const { data } = useQuery({
    queryKey: ['comercial', 'comissao-v2', 'fase-historico', empresaId],
    queryFn: () => buscarHistoricoFase(empresaId),
  })
  if (!data || data.length === 0) return null
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        <History className="mr-1 inline h-3 w-3" aria-hidden />
        Ajustes anteriores ({data.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {data.map((h) => (
          <li key={h.id} className="rounded-md border p-2 text-xs">
            <div className="text-muted-foreground">
              {fmtData(h.marco_anterior) || '—'} → {fmtData(h.marco_novo) || '—'} ·{' '}
              {h.fase_anterior ?? 'pelo relógio'} → {h.fase_nova ?? 'pelo relógio'}
            </div>
            <div className="mt-1">{h.motivo}</div>
            <div className="mt-1 text-muted-foreground">
              {h.usuarios?.nome ?? 'alguém'} · {dataHora(h.alterado_em)}
            </div>
          </li>
        ))}
      </ul>
    </details>
  )
}

function AjustarDialog({
  conta, derivada, onOpenChange, onFeito,
}: {
  conta: ContaFase | null
  derivada: FaseConta | null
  onOpenChange: (v: boolean) => void
  onFeito: () => void
}) {
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [marco, setMarco] = React.useState('')
  const [fase, setFase] = React.useState<'' | 'CRESCIMENTO' | 'MANUTENCAO'>('')

  React.useEffect(() => {
    if (conta) {
      setMarco(conta.marco_ativacao ?? '')
      setFase(conta.fase_manual ?? '')
      setErro(null)
    }
  }, [conta])

  const hoje = new Date().toISOString().slice(0, 10)

  return (
    <Dialog open={conta !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!conta) return
            const fd = new FormData(e.currentTarget)
            setSalvando(true)
            setErro(null)
            const r = await ajustarFaseContaAction({
              empresa_id: conta.empresa_id,
              marco_ativacao: marco === '' ? null : marco,
              fase_manual: fase === '' ? null : fase,
              motivo: String(fd.get('motivo') ?? ''),
            })
            setSalvando(false)
            if (!r.ok) return setErro(r.message)
            toast.success(
              r.data.aviso ??
                `Recalculado: ${r.data.lancamentos} lançamento(s), ${brlCurto(r.data.total)} nesta conta no mês.`,
            )
            onFeito()
          }}
        >
          <DialogHeader>
            <DialogTitle>{conta?.razao_social ?? 'Conta'}</DialogTitle>
            <DialogDescription>
              A fase decide a taxa. Ao salvar, os lançamentos <strong>provisionados</strong> desta
              conta no mês corrente são recalculados — meses fechados e lançamentos já aprovados ou
              pagos não são tocados.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="marco">Data de início da conta</Label>
              <Input
                id="marco"
                type="date"
                max={hoje}
                value={marco}
                onChange={(e) => setMarco(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                O zero do relógio. Por padrão é a primeira cessão convertida que o sistema viu —
                que nem sempre é a primeira que aconteceu.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fase">Fase</Label>
              <select
                id="fase"
                value={fase}
                onChange={(e) => setFase(e.target.value as '' | 'CRESCIMENTO' | 'MANUTENCAO')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">
                  Pelo relógio{derivada ? ` — hoje daria ${FASE_CONTA_LABELS[derivada]}` : ''}
                </option>
                <option value="CRESCIMENTO">{FASE_CONTA_LABELS.CRESCIMENTO}</option>
                <option value="MANUTENCAO">{FASE_CONTA_LABELS.MANUTENCAO}</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {fase === ''
                  ? 'A fase sai da idade da conta, com os prazos que estiverem vigentes.'
                  : FASE_CONTA_DESCRICOES[fase]}
              </p>
              {derivada === 'RESIDUAL' ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  Esta conta já passou do sunset do vendedor. O <strong>sunset vence a tag</strong>:
                  ela continua residual e o vendedor não recebe, escolha você o que escolher aqui.
                  Para mudar isso, a data de início é o caminho.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="motivo-fase">Motivo</Label>
              <Input
                id="motivo-fase"
                name="motivo"
                required
                minLength={3}
                placeholder="Ex.: opera conosco desde 2025 pelo CNPJ da matriz."
              />
              <p className="text-xs text-muted-foreground">
                Obrigatório. É a resposta que a contestação da folha vai pedir — e a única, porque
                a data e a tag não explicam a si mesmas.
              </p>
            </div>

            {conta ? <Historico empresaId={conta.empresa_id} /> : null}

            {erro ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {erro}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? 'Salvando e recalculando…' : 'Salvar e recalcular'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ContasFase() {
  const qc = useQueryClient()
  const [alvo, setAlvo] = React.useState<ContaFase | null>(null)
  const [busca, setBusca] = React.useState('')

  const contas = useQuery({ queryKey: comissaoKeys.contasFase(), queryFn: buscarContasFase })
  const parametros = useQuery({ queryKey: comissaoKeys.parametros(), queryFn: buscarParametros })

  if (contas.isLoading) return <Skeleton className="h-96 w-full" />

  const params = vigentesHoje(parametros.data ?? [])
  const termo = busca.trim().toLowerCase()
  const lista = (contas.data ?? []).filter(
    (c) =>
      termo === '' ||
      (c.razao_social ?? '').toLowerCase().includes(termo) ||
      c.cnpj.includes(termo.replace(/\D/g, '')),
  )
  const semMarco = (contas.data ?? []).filter((c) => c.marco_ativacao === null).length

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="h-4 w-4" aria-hidden />
                Relógio das contas
              </CardTitle>
              <CardDescription>
                A idade da conta decide se ela paga crescimento ou manutenção. O zero é a primeira
                cessão convertida — que nem sempre é a primeira que aconteceu.
                {semMarco > 0 ? ` ${semMarco} conta(s) ainda sem data de início.` : ''}
              </CardDescription>
            </div>
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Filtrar por nome ou CNPJ…"
              className="w-56"
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Conta</th>
                  <th className="px-4 py-2 text-left font-medium">Gestão</th>
                  <th className="px-4 py-2 text-left font-medium">Início</th>
                  <th className="px-4 py-2 text-right font-medium">Idade</th>
                  <th className="px-4 py-2 text-left font-medium">Fase</th>
                  <th className="px-4 py-2 text-right font-medium">Volume do mês</th>
                  <th className="px-4 py-2 text-right font-medium">Comissão</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => {
                  const derivada = faseDerivada(c, params)
                  const efetiva: FaseConta | null =
                    derivada === 'RESIDUAL' ? 'RESIDUAL' : (c.fase_manual ?? derivada)
                  const idade = c.marco_ativacao ? idadeEmMeses(c.marco_ativacao, new Date()) : null
                  const discorda = c.fase_manual !== null && derivada !== null && c.fase_manual !== derivada
                  return (
                    <tr key={c.empresa_id} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`/empresas/${c.empresa_id}`} className="font-medium hover:underline">
                          {c.razao_social ?? c.cnpj}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {c.titular ?? 'sem titular'}
                          {c.estagio === 'ex_cliente' ? ' · ex-cliente' : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {c.gestao_operacao ? (
                          GESTAO_OPERACAO_LABELS[c.gestao_operacao as GestaoOperacao]
                        ) : (
                          <span className="text-muted-foreground">não classificada</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs tabular-nums">
                        {c.marco_ativacao ? (
                          fmtData(c.marco_ativacao)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-xs tabular-nums">
                        {idade === null ? '—' : `${idade} m`}
                      </td>
                      <td className="px-4 py-2">
                        {efetiva ? (
                          <Badge variant={efetiva === 'RESIDUAL' ? 'destructive' : 'outline'} className="text-[10px]">
                            {FASE_CONTA_LABELS[efetiva]}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {/*
                          A derivada aparece ao lado da fixada quando as duas discordam. É a
                          discordância que alguém precisa revisar meses depois, e ela some
                          se a tela mostrar só o resultado.
                        */}
                        {discorda && derivada ? (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">
                            fixada · relógio diria {FASE_CONTA_LABELS[derivada]}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {brlCurto(c.volume_mes)}
                        {c.cessoes_mes > 0 ? (
                          <div className="text-[10px] text-muted-foreground">
                            {c.cessoes_mes} cessão(ões)
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">
                        {brlCurto(c.comissao_mes)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setAlvo(c)}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          <span className="sr-only">Ajustar</span>
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground">
          Ajustar aqui recalcula <strong>só esta conta</strong> e <strong>só o mês aberto</strong>.
          Competência fechada é imutável, e lançamento já aprovado ou pago não é tocado nem no mês
          corrente — o que uma pessoa decidiu não é recalculável.
        </CardContent>
      </Card>

      <AjustarDialog
        conta={alvo}
        derivada={alvo ? faseDerivada(alvo, params) : null}
        onOpenChange={(v) => { if (!v) setAlvo(null) }}
        onFeito={() => {
          setAlvo(null)
          void qc.invalidateQueries({ queryKey: comissaoKeys.contasFase() })
          void qc.invalidateQueries({ queryKey: ['comercial', 'comissao-v2'] })
        }}
      />
    </div>
  )
}
