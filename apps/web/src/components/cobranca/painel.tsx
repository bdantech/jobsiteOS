'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle } from 'lucide-react'
import { PROTESTO_SITUACAO_LABELS, brlCurto, paletaCategorica, type ProtestoSituacao } from '@jobsiteos/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarPainel, buscarSouGestor, gestaoKeys, type PainelGestor } from './gestao-queries'
import { RelogioApolice } from './relogio-apolice'
import { SacadosBloqueados } from './painel-bloqueados'
import { InsolvenciasCard } from './painel-insolvencias'
import { brl, data, sinistroEstagioLabel } from './format'

/**
 * Painel da Cobrança (§12).
 *
 * A ordem é a do prompt, e ela é deliberada: o RELÓGIO primeiro, para todo mundo que
 * tem o módulo — prazo de apólice não é número de gestão, é trabalho do dia. Depois,
 * só para o gestor (a RPC `app_cobranca_painel` devolve `{gestor:false}` aos demais),
 * os números consolidados. Por último o que pede decisão humana: sacados bloqueados
 * que podem ser regularizados e insolvências a confirmar.
 */
export function PainelCobranca({ usuarioId }: { usuarioId: string }) {
  const gestor = useQuery({ queryKey: gestaoKeys.gestor(), queryFn: buscarSouGestor })
  const painel = useQuery({ queryKey: gestaoKeys.painel(), queryFn: buscarPainel })
  const souGestor = gestor.data === true

  return (
    <div className="space-y-6">
      <RelogioApolice usuarioId={usuarioId} gestor={souGestor} />

      {painel.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : painel.data && painel.data.gestor ? (
        <NumerosGestao p={painel.data} />
      ) : null}

      <SacadosBloqueados gestor={souGestor} />
      <InsolvenciasCard />
    </div>
  )
}

function usePaleta(): string[] {
  const [escuro, setEscuro] = React.useState(false)
  React.useEffect(() => {
    const raiz = document.documentElement
    const ler = () =>
      setEscuro(
        raiz.dataset.theme === 'dark' ||
          (raiz.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches),
      )
    ler()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', ler)
    const obs = new MutationObserver(ler)
    obs.observe(raiz, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => {
      mq.removeEventListener('change', ler)
      obs.disconnect()
    }
  }, [])
  return paletaCategorica(escuro)
}

const FAIXAS_AGING = ['15–30', '31–60', '61–90', '91–180', '180+']

function NumerosGestao({ p }: { p: PainelGestor }) {
  const paleta = usePaleta()
  // Faixa sem título ainda aparece, com zero: um aging com buracos no eixo engana
  // sobre onde a carteira está.
  const aging = FAIXAS_AGING.map((f) => {
    const a = p.aging.find((x) => x.faixa === f)
    return { faixa: `${f} d`, valor: Number(a?.valor ?? 0), qtd: Number(a?.qtd ?? 0) }
  })
  const taxa = p.taxa_recuperacao === null ? null : Number(p.taxa_recuperacao)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Valor em cobrança" valor={brl(p.em_cobranca)} nota="face dos títulos ativos" />
        <Kpi rotulo="Recuperado no mês" valor={brl(p.recuperado_mes)} />
        <Kpi rotulo="Recuperado em 12 meses" valor={brl(p.recuperado_12m)} />
        <Kpi
          rotulo="Taxa de recuperação"
          valor={taxa === null ? '—' : `${(taxa * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
          nota="recebido ÷ face, cobranças dos últimos 12 meses"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Aging da carteira em cobrança (dias desde o vencimento)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={aging} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis dataKey="faixa" tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    width={56}
                    stroke="currentColor"
                    className="text-muted-foreground"
                    tickFormatter={(v: number) => brlCurto(v)}
                  />
                  <Tooltip
                    cursor={{ className: 'fill-muted/40' }}
                    content={({ payload }) => {
                      const d = payload?.[0]?.payload as { faixa: string; valor: number; qtd: number } | undefined
                      return d ? (
                        <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                          <p className="font-medium">{d.faixa}</p>
                          <p className="tabular-nums text-muted-foreground">
                            {brl(d.valor)} · {d.qtd} título(s)
                          </p>
                        </div>
                      ) : null
                    }}
                  />
                  <Bar dataKey="valor" fill={paleta[0]} radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* A mesma série em texto: o gráfico não pode ser o único lugar do número. */}
            <dl className="mt-2 grid grid-cols-5 gap-1 text-center text-[11px] text-muted-foreground">
              {aging.map((a) => (
                <div key={a.faixa}>
                  <dt>{a.faixa}</dt>
                  <dd className="tabular-nums text-foreground">{a.qtd}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sinistros por estágio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {p.sinistros.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhum sinistro aberto.</p>
            ) : (
              p.sinistros.map((s) => (
                <div key={s.estagio} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {sinistroEstagioLabel(s.estagio)} <span className="text-muted-foreground">({s.qtd})</span>
                  </span>
                  <span className="text-right text-xs tabular-nums">
                    <span className="block">indenização est. {brl(s.indenizacao_estimada)}</span>
                    {s.proximo_prazo ? (
                      <span className="block text-muted-foreground">envio até {data(s.proximo_prazo)}</span>
                    ) : null}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Protestos por situação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {p.protestos.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhum título protestado.</p>
            ) : (
              p.protestos.map((x) => (
                <div key={x.situacao} className="flex justify-between text-sm">
                  <span>{PROTESTO_SITUACAO_LABELS[x.situacao as ProtestoSituacao] ?? x.situacao}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {x.qtd} · custas {brl(x.custas)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Custos de cobrança</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span>Aprovados pela seguradora</span>
              <span className="tabular-nums">{brl(p.custos.aprovados)}</span>
            </div>
            {/* cl. 20700.20: sem aprovação prévia, a seguradora não reembolsa. */}
            <div className="flex justify-between text-destructive">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                Não aprovados — provável não reembolsável
              </span>
              <span className="tabular-nums font-semibold">{brl(p.custos.nao_aprovados)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              A apólice só reembolsa custo de cobrança incorrido com aprovação prévia ou por instrução da seguradora
              (cl. 20700.20). Peça a aprovação antes de gastar.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Kpi({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{rotulo}</div>
        <div className="text-xl font-semibold tabular-nums">{valor}</div>
        {nota ? <div className="text-[11px] text-muted-foreground">{nota}</div> : null}
      </CardContent>
    </Card>
  )
}
