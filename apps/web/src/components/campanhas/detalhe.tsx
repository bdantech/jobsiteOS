'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Ban, Pause, Play, TriangleAlert } from 'lucide-react'
import {
  MOTIVO_EXCLUSAO_LABELS,
  STATUS_CAMPANHA_LABELS,
  STATUS_DESTINATARIO_LABELS,
  TIPO_CAMPANHA_LABELS,
  type MotivoExclusao,
  type StatusCampanha,
  type StatusDestinatario,
  type TipoCampanha,
} from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  cancelarCampanhaAction,
  pausarCampanhaAction,
  retomarCampanhaAction,
} from '@/actions/campanhas'
import { cn } from '@/lib/utils'
import {
  buscarCampanha,
  buscarDestinatarios,
  buscarMetricas,
  campanhasKeys,
} from './queries'
import type { Simulacao } from './simulacao'

/**
 * O detalhe: progresso ao vivo, destinatários com filtro por status e motivo, e
 * as métricas (§8).
 *
 * Os controles ficam no topo porque pausar é urgente por definição — quem clica
 * está tentando impedir o que sairia daqui a pouco, e um botão no rodapé de uma
 * página que rola é um botão que chega tarde.
 */

interface Metricas {
  resumo?: Record<string, number>
  taxa_resposta_pct?: number | null
  por_variante?: { variante_id: string; enviadas: number; respondidas: number; optouts: number }[]
  por_conta?: { conta: string; enviadas: number; entregues: number; falhas: number }[]
  por_intencao?: Record<string, number>
  exclusoes?: Record<string, number>
  funil?: Record<string, number>
  saude?: Record<string, number | boolean | null>
}

export function CampanhaDetalhe({ id, podeGerir }: { id: string; podeGerir: boolean }) {
  const qc = useQueryClient()
  const [filtroStatus, setFiltroStatus] = React.useState('')
  const [filtroMotivo, setFiltroMotivo] = React.useState('')
  const [agindo, setAgindo] = React.useState(false)

  const campanha = useQuery({
    queryKey: campanhasKeys.uma(id),
    queryFn: () => buscarCampanha(id),
    refetchInterval: 30_000,
  })
  const metricas = useQuery({
    queryKey: campanhasKeys.metricas(id),
    queryFn: () => buscarMetricas(id),
    refetchInterval: 30_000,
  })
  const destinatarios = useQuery({
    queryKey: campanhasKeys.destinatarios(id, `${filtroStatus}|${filtroMotivo}`),
    queryFn: () => buscarDestinatarios(id, { status: filtroStatus || undefined, motivo: filtroMotivo || undefined }),
  })

  if (campanha.isPending) return <Skeleton className="h-64 w-full" />
  if (!campanha.data) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Campanha não encontrada.</p>
  }

  const c = campanha.data
  const m = (metricas.data ?? {}) as Metricas
  const sim = (c.simulacao ?? null) as Simulacao | null
  const saude = m.saude ?? {}
  const alertaOptout =
    saude.amostra_suficiente === true &&
    typeof saude.optout_pct === 'number' &&
    typeof saude.limiar_optout_pct === 'number' &&
    saude.optout_pct >= saude.limiar_optout_pct
  const alertaBounce =
    saude.amostra_suficiente === true &&
    typeof saude.bounce_pct === 'number' &&
    typeof saude.limiar_bounce_pct === 'number' &&
    saude.bounce_pct >= saude.limiar_bounce_pct

  async function agir(
    fn: (input: unknown) => Promise<{ ok: boolean; message?: string }>,
    mensagem: string,
  ) {
    setAgindo(true)
    const r = await fn({ id })
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message ?? 'Não foi possível.')
      return
    }
    toast.success(mensagem)
    void qc.invalidateQueries({ queryKey: campanhasKeys.todas })
  }

  return (
    <div className="space-y-4">
      {/* ─── Cabeçalho e controles ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{c.nome}</CardTitle>
            <CardDescription>
              {TIPO_CAMPANHA_LABELS[c.tipo as TipoCampanha] ?? c.tipo} ·{' '}
              {c.canal === 'email' ? 'E-mail' : 'WhatsApp'} · {c.ritmo_por_dia}/dia
              {sim ? ` · ${sim.descricao_publico}` : ''}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{STATUS_CAMPANHA_LABELS[c.status as StatusCampanha] ?? c.status}</Badge>
            {podeGerir && (c.status === 'agendada' || c.status === 'executando') && (
              <Button
                size="sm"
                variant="outline"
                disabled={agindo}
                onClick={() => void agir(pausarCampanhaAction, 'Campanha pausada. O que não saiu não sai.')}
              >
                <Pause className="mr-2 h-4 w-4" aria-hidden />
                Pausar
              </Button>
            )}
            {podeGerir && c.status === 'pausada' && (
              <Button
                size="sm"
                disabled={agindo}
                onClick={() => void agir(retomarCampanhaAction, 'Campanha retomada.')}
              >
                <Play className="mr-2 h-4 w-4" aria-hidden />
                Retomar
              </Button>
            )}
            {podeGerir && c.status !== 'concluida' && c.status !== 'cancelada' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={agindo}
                onClick={() => void agir(cancelarCampanhaAction, 'Campanha cancelada.')}
              >
                <Ban className="mr-2 h-4 w-4" aria-hidden />
                Cancelar
              </Button>
            )}
          </div>
        </CardHeader>

        {(alertaOptout || alertaBounce) && (
          <CardContent>
            <div
              className={cn(
                'flex items-start gap-2 rounded-lg border p-3 text-sm',
                STATUS_SUPERFICIE.critical,
              )}
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">Saúde do canal</p>
                <p>
                  {alertaOptout && `Opt-out em ${saude.optout_pct}% (limiar ${saude.limiar_optout_pct}%). `}
                  {alertaBounce && `Bounce em ${saude.bounce_pct}% (limiar ${saude.limiar_bounce_pct}%). `}
                  Campanha ruim não queima só a campanha: queima o domínio e o número, e com eles
                  a conversa de todo mundo que já falava por ali.
                </p>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── Placar ────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metrica rotulo="Público" valor={m.resumo?.total ?? 0} />
        <Metrica rotulo="Enviadas" valor={m.resumo?.enviadas ?? 0} />
        <Metrica rotulo="Entregues" valor={m.resumo?.entregues ?? 0} />
        <Metrica rotulo="Respostas" valor={m.resumo?.respondidas ?? 0} destaque />
        <Metrica
          rotulo="Taxa de resposta"
          texto={m.taxa_resposta_pct === null || m.taxa_resposta_pct === undefined ? '—' : `${m.taxa_resposta_pct}%`}
        />
        <Metrica rotulo="Opt-outs" valor={m.resumo?.optouts ?? 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ─── Variantes (A/B) ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Por variante</CardTitle>
            <CardDescription>
              Mesmo público, mesma janela: a diferença entre elas é o texto.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(m.por_variante ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada enviado ainda.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variante</TableHead>
                    <TableHead className="text-right">Enviadas</TableHead>
                    <TableHead className="text-right">Respostas</TableHead>
                    <TableHead className="text-right">Taxa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(m.por_variante ?? []).map((v) => (
                    <TableRow key={v.variante_id}>
                      <TableCell>{v.variante_id}</TableCell>
                      <TableCell className="text-right tabular-nums">{v.enviadas}</TableCell>
                      <TableCell className="text-right tabular-nums">{v.respondidas}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {v.enviadas > 0 ? `${((v.respondidas / v.enviadas) * 100).toFixed(1)}%` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ─── Contas remetentes ───────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Por conta remetente</CardTitle>
            <CardDescription>
              Uma conta entregando muito abaixo das irmãs é a conta, não a mensagem.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(m.por_conta ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada enviado ainda.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Conta</TableHead>
                    <TableHead className="text-right">Enviadas</TableHead>
                    <TableHead className="text-right">Entregues</TableHead>
                    <TableHead className="text-right">Falhas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(m.por_conta ?? []).map((v) => (
                    <TableRow key={v.conta}>
                      <TableCell className="font-mono text-xs">{v.conta}</TableCell>
                      <TableCell className="text-right tabular-nums">{v.enviadas}</TableCell>
                      <TableCell className="text-right tabular-nums">{v.entregues}</TableCell>
                      <TableCell className="text-right tabular-nums">{v.falhas}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Funil até o fim ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">O funil depois da mensagem</CardTitle>
          <CardDescription>
            Atribuição por janela: a empresa recebeu e depois avançou. É correlação temporal, não
            prova de causa — sem grupo de controle não dá para afirmar mais que isso.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <Metrica rotulo="Reuniões agendadas" valor={m.funil?.reunioes_agendadas ?? 0} />
          <Metrica rotulo="Vendas abertas" valor={m.funil?.vendas_abertas ?? 0} />
          <Metrica rotulo="Ganhos" valor={m.funil?.ganhos ?? 0} />
          <Metrica
            rotulo="Valor esperado/mês"
            texto={(m.funil?.valor_esperado_mensal ?? 0).toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
              maximumFractionDigits: 0,
            })}
          />
        </CardContent>
      </Card>

      {/* ─── Respostas por intenção ────────────────────────────────────────── */}
      {Object.keys(m.por_intencao ?? {}).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Respostas por intenção</CardTitle>
            <CardDescription>Da triagem do 05A, sobre quem respondeu.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Object.entries(m.por_intencao ?? {}).map(([intencao, n]) => (
              <Badge key={intencao} variant="outline">
                {intencao}: {n}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ─── Destinatários ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Destinatários</CardTitle>
          <CardDescription>
            Os excluídos ficam aqui de propósito: a lista de quem não recebeu por falta de contato
            é uma lista de trabalho para o enriquecimento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select
              value={filtroStatus}
              onChange={(e) => {
                setFiltroStatus(e.target.value)
                if (e.target.value !== 'excluida') setFiltroMotivo('')
              }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Filtrar por status"
            >
              <option value="">Todos os status</option>
              {Object.entries(STATUS_DESTINATARIO_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {filtroStatus === 'excluida' && (
              <select
                value={filtroMotivo}
                onChange={(e) => setFiltroMotivo(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Filtrar por motivo"
              >
                <option value="">Todos os motivos</option>
                {Object.entries(MOTIVO_EXCLUSAO_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </div>

          {destinatarios.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Variante</TableHead>
                    <TableHead>Quando</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(destinatarios.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        Nada aqui com esse filtro.
                      </TableCell>
                    </TableRow>
                  )}
                  {(destinatarios.data ?? []).map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="max-w-[16rem] truncate">
                        {d.empresa_id ? (
                          <Link href={`/empresas/${d.empresa_id}`} className="hover:underline">
                            {d.empresa_nome ?? d.empresa_cnpj}
                          </Link>
                        ) : (
                          (d.empresa_nome ?? '—')
                        )}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-sm">
                        {d.contato_nome ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={d.status === 'respondida' ? 'default' : 'outline'}>
                          {STATUS_DESTINATARIO_LABELS[d.status as StatusDestinatario] ?? d.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {d.motivo_exclusao
                          ? (MOTIVO_EXCLUSAO_LABELS[d.motivo_exclusao as MotivoExclusao] ??
                            d.motivo_exclusao)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-sm">{d.variante_id ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {d.enviada_em
                          ? new Date(d.enviada_em).toLocaleString('pt-BR')
                          : d.agendada_para
                            ? `agendada ${new Date(d.agendada_para).toLocaleString('pt-BR')}`
                            : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Metrica({
  rotulo,
  valor,
  texto,
  destaque,
}: {
  rotulo: string
  valor?: number
  texto?: string
  destaque?: boolean
}) {
  return (
    <div className={cn('rounded-lg border p-3', destaque && 'border-primary')}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-xl font-semibold tabular-nums">
        {texto ?? (valor ?? 0).toLocaleString('pt-BR')}
      </p>
    </div>
  )
}
