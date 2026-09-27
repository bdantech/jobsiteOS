'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Info, Scale } from 'lucide-react'
import {
  MOTIVO_ENCERRAMENTO_LABELS,
  TIPO_MANDATO_LABELS,
  type MotivoEncerramento,
  type TipoMandato,
} from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { brlCentavos, dataCurta, horas, inteiro, pct } from './gestao-format'
import {
  buscarAgentesIa,
  buscarDesempenho,
  gestaoAgentesKeys,
  type Desempenho,
  type DesempenhoAgente,
} from './queries-gestao'
import { SomenteGestores } from './somente-gestores'

/**
 * DESEMPENHO (Prompt 09 §11.5) — quanto custa o que a IA consegue, e se ela consegue
 * mais barato que uma pessoa.
 *
 * ─── A COLUNA QUE DECIDE SE A IA CONTINUA ───────────────────────────────────
 * A comparação com os humanos. Para um SDR de IA: a taxa de reunião dos mandatos dele
 * contra a taxa de reunião dos leads dos SDRs humanos no mesmo período. Para um
 * originador: a taxa de conversão das notas dele contra a dos originadores humanos. A
 * observação da RPC fica VISÍVEL ao lado, sempre: o humano não tem o filtro de escopo do
 * agente, então a comparação é de ritmo, não do mesmo recorte de empresas — e uma decisão
 * de desligar (ou de escalar) a IA tomada sem essa ressalva é tomada sobre um número que
 * ele não diz.
 *
 * ─── `reuniões` E `convertidos` SÃO FATOS DO BANCO ──────────────────────────
 * O mandato tem a reunião (em `vendedor_eventos`) ou não tem; a nota chegou a
 * `convertida` pelo sync da plataforma ou não chegou. Nada aqui é o agente declarando o
 * próprio sucesso.
 */

const PERIODOS = [7, 30, 90] as const

const CANAL_LABELS: Record<string, string> = {
  ligacao: 'Ligação',
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  outro: 'Outro',
}

export function DesempenhoTela() {
  return (
    <SomenteGestores titulo="O painel de desempenho">
      <Painel />
    </SomenteGestores>
  )
}

function Painel() {
  const [dias, setDias] = React.useState<(typeof PERIODOS)[number]>(30)
  const d = useQuery({ queryKey: gestaoAgentesKeys.desempenho(dias), queryFn: () => buscarDesempenho(dias) })
  const agentes = useQuery({ queryKey: gestaoAgentesKeys.personas(), queryFn: buscarAgentesIa })
  const tipoPorAgente = React.useMemo(
    () => new Map((agentes.data ?? []).map((a) => [a.id, a.tipo === 'originador' ? 'originador' : 'sdr'])),
    [agentes.data],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Desempenho dos agentes</h2>
          <p className="text-sm text-muted-foreground">
            Mandatos criados no período{d.data ? `, desde ${dataCurta(d.data.desde)}` : ''}.
          </p>
        </div>
        <Tabs value={String(dias)} onValueChange={(v) => setDias(Number(v) as (typeof PERIODOS)[number])}>
          <TabsList>
            {PERIODOS.map((p) => (
              <TabsTrigger key={p} value={String(p)}>
                {p} dias
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {d.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : d.isError ? (
        <div className={cn('rounded-lg border p-4 text-sm', STATUS_SUPERFICIE.critical)}>
          Não foi possível carregar o desempenho: {d.error.message}
        </div>
      ) : (
        <Conteudo d={d.data} tipoPorAgente={tipoPorAgente} dias={dias} />
      )}
    </div>
  )
}

/** A taxa do agente na mesma régua que a dos humanos: reunião para SDR, conversão para originador. */
function taxaComparavel(a: DesempenhoAgente, tipo: 'sdr' | 'originador'): number | null {
  if (a.mandatos === 0) return null
  return (tipo === 'originador' ? a.convertidos : a.reunioes) / a.mandatos
}

function Comparacao({ ia, humano }: { ia: number | null; humano: number | null }) {
  if (ia === null || humano === null) {
    return <span className="text-xs text-muted-foreground">{ia === null ? 'sem mandatos' : 'sem base humana'}</span>
  }
  const razao = humano > 0 ? ia / humano : null
  const tom = razao === null ? 'neutral' : razao >= 1 ? 'success' : razao >= 0.7 ? 'warning' : 'critical'
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 tabular-nums">
        <span className="font-medium">{pct(ia)}</span>
        <span className="text-xs text-muted-foreground">vs {pct(humano)}</span>
      </div>
      <Badge variant={tom}>
        {razao === null ? 'humanos em 0%' : razao >= 1 ? 'igual ou acima' : `${Math.round(razao * 100)}% do humano`}
      </Badge>
    </div>
  )
}

function Conteudo({
  d,
  tipoPorAgente,
  dias,
}: {
  d: Desempenho
  tipoPorAgente: Map<string, string>
  dias: number
}) {
  const motivos = Object.entries(d.motivos_encerramento).sort((a, b) => b[1] - a[1])
  const maxMotivo = Math.max(1, ...motivos.map(([, n]) => n))
  const totalEncerrados = motivos.reduce((s, [, n]) => s + n, 0)
  const semMandatos = d.por_agente.every((a) => a.mandatos === 0)

  return (
    <div className="space-y-4">
      {/* ─── A comparação com os humanos ───────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="h-4 w-4" aria-hidden /> Comparação com os vendedores humanos
          </CardTitle>
          <CardDescription>É esta coluna que decide se a IA continua.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">SDRs humanos — taxa de reunião</p>
              <p className="text-2xl font-semibold tabular-nums">{pct(d.humanos.sdr_taxa_reuniao)}</p>
              <p className="text-xs text-muted-foreground">Leads distribuídos no período que chegaram a reunião.</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Originadores humanos — taxa de conversão
              </p>
              <p className="text-2xl font-semibold tabular-nums">{pct(d.humanos.originacao_taxa_conversao)}</p>
              <p className="text-xs text-muted-foreground">Notas atribuídas no período que chegaram a convertida.</p>
            </div>
          </div>
          {d.humanos.observacao ? (
            <p className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.info)}>
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {d.humanos.observacao}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ─── Por agente ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Por agente</CardTitle>
          <CardDescription>
            Taxa de sucesso = concluídos sobre os mandatos que já terminaram (concluídos, encerrados e
            escalados). Custo é o gasto real registrado nos mandatos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {d.por_agente.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum agente de IA cadastrado — crie um em Personas para ver números aqui.
            </p>
          ) : (
            <>
              {semMandatos ? (
                <p className="mb-3 text-sm text-muted-foreground">
                  Nenhum mandato criado nos últimos {dias} dias. Os números aparecem assim que uma regra
                  ligada (Configurações) ou um “Delegar ao agente” criar mandatos.
                </p>
              ) : null}
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agente</TableHead>
                      <TableHead className="text-right">Mandatos</TableHead>
                      <TableHead className="text-right">Concluídos</TableHead>
                      <TableHead className="text-right">Sucesso</TableHead>
                      <TableHead className="text-right">Custo total</TableHead>
                      <TableHead className="text-right">Por concluído</TableHead>
                      <TableHead className="text-right">Por reunião</TableHead>
                      <TableHead className="text-right">Por conversão</TableHead>
                      <TableHead className="text-right">Até o objetivo</TableHead>
                      <TableHead className="text-right">Reuniões</TableHead>
                      <TableHead className="text-right">Convertidos</TableHead>
                      <TableHead className="min-w-[160px] bg-muted/40">vs humanos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.por_agente.map((a) => {
                      const tipo = (tipoPorAgente.get(a.agente_id) ?? 'sdr') as 'sdr' | 'originador'
                      const humano =
                        tipo === 'originador' ? d.humanos.originacao_taxa_conversao : d.humanos.sdr_taxa_reuniao
                      const tipos = Object.entries(a.por_tipo ?? {})
                      return (
                        <TableRow key={a.agente_id}>
                          <TableCell className="align-top">
                            <p className="font-medium">{a.nome}</p>
                            <p className="text-xs text-muted-foreground">
                              {tipo === 'originador' ? 'Originador' : 'SDR'} · {inteiro(a.ativos)} ativos ·{' '}
                              {inteiro(a.escalados)} escalados
                            </p>
                            {tipos.length > 0 ? (
                              <p className="text-xs text-muted-foreground">
                                {tipos
                                  .map(
                                    ([t, v]) =>
                                      `${TIPO_MANDATO_LABELS[t as TipoMandato] ?? t}: ${v.concluidos}/${v.total}`,
                                  )
                                  .join(' · ')}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right align-top tabular-nums">{inteiro(a.mandatos)}</TableCell>
                          <TableCell className="text-right align-top tabular-nums">{inteiro(a.concluidos)}</TableCell>
                          <TableCell className="text-right align-top tabular-nums">{pct(a.taxa_sucesso)}</TableCell>
                          <TableCell className="text-right align-top tabular-nums">{brlCentavos(a.custo_centavos)}</TableCell>
                          <TableCell className="text-right align-top tabular-nums">{brlCentavos(a.custo_por_concluido)}</TableCell>
                          <TableCell className="text-right align-top tabular-nums">{brlCentavos(a.custo_por_reuniao)}</TableCell>
                          <TableCell className="text-right align-top tabular-nums">{brlCentavos(a.custo_por_conversao)}</TableCell>
                          <TableCell className="text-right align-top tabular-nums">{horas(a.horas_ate_objetivo)}</TableCell>
                          <TableCell className="text-right align-top tabular-nums">{inteiro(a.reunioes)}</TableCell>
                          <TableCell className="text-right align-top tabular-nums">{inteiro(a.convertidos)}</TableCell>
                          <TableCell className="bg-muted/40 align-top">
                            <Comparacao ia={taxaComparavel(a, tipo)} humano={humano} />
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {tipo === 'originador' ? 'conversão de NF' : 'taxa de reunião'}
                            </p>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                A taxa da IA na última coluna é sobre todos os mandatos do período, inclusive os que ainda
                estão em andamento — tende a subir conforme eles terminam.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ─── Por playbook ────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Por playbook</CardTitle>
            <CardDescription>O “como” de cada tipo de mandato. Editável em Comunicação › Playbooks.</CardDescription>
          </CardHeader>
          <CardContent>
            {d.por_playbook.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum mandato no período.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Playbook</TableHead>
                    <TableHead className="text-right">Mandatos</TableHead>
                    <TableHead className="text-right">Concluídos</TableHead>
                    <TableHead className="text-right">Sucesso</TableHead>
                    <TableHead className="text-right">Por concluído</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.por_playbook.map((p) => (
                    <TableRow key={p.playbook}>
                      <TableCell>{p.playbook === 'sem playbook' ? 'Sem playbook' : p.playbook}</TableCell>
                      <TableCell className="text-right tabular-nums">{inteiro(p.mandatos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{inteiro(p.concluidos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(p.taxa_sucesso)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brlCentavos(p.custo_por_concluido)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ─── Motivos de encerramento ─────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" aria-hidden /> Motivos de encerramento
            </CardTitle>
            <CardDescription>
              Um agente que encerra muito por “todos os contatos tentados” tem problema de dados, não de
              conversa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {motivos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum mandato terminou no período.</p>
            ) : (
              <ul className="space-y-2">
                {motivos.map(([motivo, n]) => (
                  <li key={motivo} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span>
                        {motivo === 'sem motivo'
                          ? 'Sem motivo registrado'
                          : (MOTIVO_ENCERRAMENTO_LABELS[motivo as MotivoEncerramento] ?? motivo)}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {inteiro(n)} · {pct(n / totalEncerrados, 0)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className={cn(
                          'h-2 rounded-full',
                          motivo === 'objetivo_atingido' ? 'bg-primary' : 'bg-chart-3',
                        )}
                        style={{ width: `${(n / maxMotivo) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ─── Eficácia por material ───────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Eficácia por material</CardTitle>
            <CardDescription>Resposta do mesmo contato em até 3 dias depois do envio.</CardDescription>
          </CardHeader>
          <CardContent>
            {d.materiais.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum material enviado no período.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Enviados</TableHead>
                    <TableHead className="text-right">Respondidos</TableHead>
                    <TableHead className="text-right">Taxa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.materiais.map((m) => (
                    <TableRow key={m.material_id}>
                      <TableCell>{m.nome}</TableCell>
                      <TableCell className="text-right tabular-nums">{inteiro(m.enviados)}</TableCell>
                      <TableCell className="text-right tabular-nums">{inteiro(m.respondidos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(m.taxa_resposta)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ─── Eficácia por canal ──────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Eficácia por canal</CardTitle>
            <CardDescription>
              Mensagens e e-mails: resposta em até 3 dias. Ligação: atendida e concluída.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {d.canais.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum contato feito no período.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Canal</TableHead>
                    <TableHead className="text-right">Tentativas</TableHead>
                    <TableHead className="text-right">Com resposta</TableHead>
                    <TableHead className="text-right">Taxa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.canais.map((c) => (
                    <TableRow key={c.canal}>
                      <TableCell>{CANAL_LABELS[c.canal] ?? c.canal}</TableCell>
                      <TableCell className="text-right tabular-nums">{inteiro(c.enviados)}</TableCell>
                      <TableCell className="text-right tabular-nums">{inteiro(c.respondidos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(c.taxa_resposta)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
