'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CalendarPlus, ChevronRight, LayoutGrid, Table2 } from 'lucide-react'
import {
  ESTAGIOS_SDR,
  ESTAGIO_SDR_LABELS,
  TIPO_VENDEDOR_LABELS,
  closerParaConta,
  rotuloFit,
  type CloserComTerritorio,
  type EstagioSdr,
  type TipoVendedorId,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { atribuirLeadSdrAction, moverLeadAction } from '@/actions/comercial'
import { cn } from '@/lib/utils'
import { DonoDoCard } from './dono-do-card'
import {
  buscarLeads, buscarMotivos, buscarTerritoriosCloser, buscarVendedores, buscarVendedoresVisiveis,
  comercialKeys,
  type LeadComEmpresa,
} from './queries'

/**
 * Funil de reuniões do SDR — mesma forma da esteira de crédito (04d §4.4): um cartão só,
 * kanban por estágio, tabela como alternativa.
 *
 * A forma é a mesma porque a pergunta é a mesma — "onde está cada coisa, e o que falta
 * nela" — e duas telas que respondem à mesma pergunta com layouts diferentes obrigam a
 * pessoa a reaprender a ler a cada troca de módulo.
 *
 * O estágio diz ONDE o lead está; o FIT é um julgamento sobre a empresa, e não move o
 * card. Marcar sem fit encerra o lead onde ele está, e é isso que dá a informação que
 * antes se perdia: um lead que morreu antes do primeiro contato e um que morreu depois
 * de uma reunião contam coisas diferentes sobre a régua do Mercado.
 *
 * Duas ações pedem mais que um clique, e isso é deliberado: **sem fit** exige motivo, e
 * **agendar** exige data e closer. Tudo o mais é um clique só — um funil onde mover
 * custa três telas é um funil que fica desatualizado. É a mesma razão de não haver
 * arrastar-e-soltar aqui nem na esteira.
 */

const brl = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** As colunas do kanban, na ordem do trabalho. */
const COLUNAS = ESTAGIOS_SDR

/** O tom do card conta o julgamento antes de qualquer leitura — como na esteira. */
function classeDoLead(l: LeadComEmpresa): string {
  if (l.fit === false) return 'border-destructive/40 bg-destructive/5'
  if (l.encerrado_em) return 'border-muted-foreground/30 bg-muted/40'
  if (l.fit === true) return 'border-emerald-500/40 bg-emerald-500/5'
  return ''
}

export function FunilSdr({ ehGestor }: { ehGestor: boolean }) {
  const qc = useQueryClient()
  const [sdrId, setSdrId] = React.useState<string | null>(null)
  const [vista, setVista] = React.useState<'kanban' | 'tabela'>('kanban')
  const [agendando, setAgendando] = React.useState<LeadComEmpresa | null>(null)
  const [semFit, setSemFit] = React.useState<LeadComEmpresa | null>(null)
  const [agindo, setAgindo] = React.useState(false)
  // Encerrados escondidos por padrão: o kanban é a fila de trabalho, e o que morreu não
  // pede trabalho. O toggle existe porque revisar as mortes é o uso da semana seguinte.
  const [mostrarEncerrados, setMostrarEncerrados] = React.useState(false)

  const vendedores = useQuery({ queryKey: comercialKeys.vendedores(), queryFn: buscarVendedores })
  // Quem eu posso ABRIR — não é a mesma lista de quem existe. O seletor sai daqui para
  // não oferecer um funil que a RLS devolveria vazio.
  const alcance = useQuery({ queryKey: comercialKeys.visiveis(), queryFn: buscarVendedoresVisiveis })
  const leads = useQuery({ queryKey: comercialKeys.leads(sdrId), queryFn: () => buscarLeads(sdrId) })
  const motivos = useQuery({
    queryKey: comercialKeys.motivos('sdr_sem_fit'),
    queryFn: () => buscarMotivos('sdr_sem_fit'),
  })
  // Territórios dos closers: é com eles que a tela SUGERE o destino da reunião.
  const territorios = useQuery({
    queryKey: comercialKeys.territorios(),
    queryFn: buscarTerritoriosCloser,
  })

  // Gestor sempre vê o seletor: para ele "todos" é uma informação, não um default
  // silencioso. Vendedor comum só vê quando há realmente mais de um funil ao alcance.
  const sdrsVisiveis = (alcance.data ?? []).filter((v) => v.tipo === 'sdr')
  const mostrarSeletor = ehGestor || sdrsVisiveis.length > 1
  const nomePorId = new Map((vendedores.data ?? []).map((v) => [v.id, v.nome]))

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['comercial'] })
  }

  const nomeDoVendedor = (id: string | null) => (id ? (nomePorId.get(id) ?? null) : null)

  async function reatribuir(lead: LeadComEmpresa, sdrDestino: string) {
    setAgindo(true)
    const r = await atribuirLeadSdrAction({ lead_id: lead.id, sdr_id: sdrDestino })
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    // O SLA reinicia junto (o RPC zera `ultimo_toque_em`): quem acabou de receber não
    // pode nascer atrasado pelo tempo que o anterior deixou o lead parado.
    toast.success(`Lead agora é de ${nomeDoVendedor(sdrDestino) ?? 'outro SDR'}.`)
    recarregar()
  }

  async function mover(lead: LeadComEmpresa, estagio: EstagioSdr, extra: Record<string, unknown> = {}) {
    setAgindo(true)
    const r = await moverLeadAction({ lead_id: lead.id, estagio, ...extra })
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success(`Movido para ${ESTAGIO_SDR_LABELS[estagio]}.`)
    recarregar()
    return true
  }

  /** Julgar o fit. NÃO move o card — o estágio continua dizendo até onde ele chegou. */
  async function julgar(lead: LeadComEmpresa, fit: boolean, motivo?: string) {
    setAgindo(true)
    const r = await moverLeadAction({ lead_id: lead.id, fit, sem_fit_motivo: motivo ?? null })
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success(fit ? 'Marcado com fit.' : 'Marcado sem fit — o lead foi encerrado aqui.')
    recarregar()
    return true
  }

  if (leads.isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  if (leads.isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {leads.error instanceof Error ? leads.error.message : 'Erro ao carregar o funil.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const todos = leads.data ?? []
  const visiveis = todos.filter((l) => mostrarEncerrados || !l.encerrado_em)
  const encerrados = todos.filter((l) => l.encerrado_em).length

  const porEstagio = new Map<string, LeadComEmpresa[]>()
  for (const l of visiveis) {
    porEstagio.set(l.estagio, [...(porEstagio.get(l.estagio) ?? []), l])
  }

  const closers = (vendedores.data ?? []).filter((v) => v.ativo && v.tipo === 'vendedor')

  /**
   * O closer cujo território cobre esta conta. SUGESTÃO, não imposição: o SDR pode
   * escolher outro, e a tela deixa. Território descreve o recorte normal; a exceção
   * (o closer que já conhece aquele dono) é justamente o que uma regra automática erraria.
   */
  const sugestao = agendando?.empresas
    ? closerParaConta(
        { uf: agendando.empresas.uf, faturamento: agendando.empresas.faturamento_anual ?? null },
        closers.map<CloserComTerritorio>((v) => {
          const t = (territorios.data ?? {})[v.id]
          return {
            vendedor_id: v.id,
            territorio: t ?? null,
            vendas_vivas: 0,
          }
        }),
      )
    : null

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Funil de Reuniões</CardTitle>
              <CardDescription>
                {visiveis.length} lead(s). <strong>Fit é um julgamento sobre a empresa, não
                uma etapa</strong> — marcar sem fit encerra o lead onde ele está, e é isso que
                diz até onde ele chegou antes de morrer.
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {encerrados > 0 && (
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={mostrarEncerrados}
                    onChange={(e) => setMostrarEncerrados(e.target.checked)}
                  />
                  Mostrar {encerrados} encerrado(s)
                </label>
              )}
              {mostrarSeletor && (
                <Select value={sdrId ?? 'todos'} onValueChange={(v) => setSdrId(v === 'todos' ? null : v)}>
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder="Todos os SDRs" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os SDRs</SelectItem>
                    {sdrsVisiveis.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVista(vista === 'kanban' ? 'tabela' : 'kanban')}
              >
                {vista === 'kanban' ? (
                  <>
                    <Table2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Tabela
                  </>
                ) : (
                  <>
                    <LayoutGrid className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Kanban
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {todos.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nenhum lead ainda.</p>
              <p className="mt-1">
                A distribuição semanal roda na segunda de manhã e enche esta fila; inbound entra
                por criação manual.
              </p>
            </div>
          ) : vista === 'kanban' ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {COLUNAS.map((coluna) => {
                const itens = porEstagio.get(coluna) ?? []
                return (
                  <div key={coluna} className="w-64 shrink-0 space-y-2">
                    <div className="flex items-baseline justify-between gap-2 border-b pb-1">
                      <p className="text-xs font-medium">{ESTAGIO_SDR_LABELS[coluna]}</p>
                      <span className="text-xs tabular-nums text-muted-foreground">{itens.length}</span>
                    </div>
                    <div className="space-y-2">
                      {itens.map((l) => (
                        <div
                          key={l.id}
                          className={cn(
                            'space-y-1.5 rounded-md border p-2 text-sm',
                            classeDoLead(l),
                            l.encerrado_em && 'opacity-70',
                          )}
                        >
                          <Link
                            href={l.empresas ? `/empresas/${l.empresas.id}` : '#'}
                            className="line-clamp-2 font-medium hover:underline"
                          >
                            {l.empresas?.razao_social ?? 'Empresa'}
                          </Link>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            {l.empresas?.uf ? <Badge variant="outline" className="text-[10px]">{l.empresas.uf}</Badge> : null}
                            {/* O fit fica no card, não na coluna: é atributo, não lugar. */}
                            {l.fit === true ? (
                              <Badge className="bg-emerald-100 text-[10px] text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200">
                                Com fit
                              </Badge>
                            ) : l.fit === false ? (
                              <Badge variant="destructive" className="text-[10px]">Sem fit</Badge>
                            ) : null}
                            {l.encerrado_motivo === 'expirado' ? (
                              <Badge variant="secondary" className="text-[10px]">Expirado</Badge>
                            ) : null}
                          </div>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {brl(l.empresas?.valor_esperado_mensal)}/mês esperado
                          </p>
                          {/*
                            O dono só aparece na lista NÃO filtrada: com o filtro
                            ligado ele repetiria em cada card o que o seletor no topo
                            já diz, e informação constante rouba espaço do que varia.
                          */}
                          {!sdrId && (
                            <DonoDoCard
                              nome={nomeDoVendedor(l.sdr_id)}
                              tipos={['sdr']}
                              podeTrocar={ehGestor}
                              ocupado={agindo}
                              onTrocar={(id) => reatribuir(l, id)}
                            />
                          )}
                          {/*
                            Só os próximos passos plausíveis, e o julgamento do fit em
                            separado. Um menu com os seis estágios transformaria "mover"
                            numa decisão, quando é um registro. Lead encerrado não mostra
                            ação nenhuma além de reabrir — oferecer "agendar" num lead
                            morto é convidar ao erro.
                          */}
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {l.encerrado_em ? (
                              l.encerrado_motivo === 'sem_fit' ? (
                                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={agindo}
                                  onClick={() => void julgar(l, true)}>
                                  Reabrir (era engano)
                                </Button>
                              ) : (
                                <span className="text-[11px] text-muted-foreground">
                                  Encerrado sem toque — volta na próxima distribuição.
                                </span>
                              )
                            ) : (
                              <>
                                {coluna === 'a_contatar' && (
                                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={agindo}
                                    onClick={() => void mover(l, 'em_conversa')}>
                                    Em conversa
                                  </Button>
                                )}
                                {coluna === 'em_conversa' && (
                                  <Button size="sm" className="h-7 text-xs" disabled={agindo}
                                    onClick={() => setAgendando(l)}>
                                    <CalendarPlus className="mr-1 h-3 w-3" aria-hidden /> Agendar
                                  </Button>
                                )}
                                {coluna === 'reuniao_agendada' && (
                                  <>
                                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={agindo}
                                      onClick={() => void mover(l, 'reuniao_realizada')}>
                                      Realizada
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={agindo}
                                      onClick={() => void mover(l, 'no_show')}>
                                      No-show
                                    </Button>
                                  </>
                                )}
                                {coluna === 'no_show' && (
                                  <Button size="sm" className="h-7 text-xs" disabled={agindo}
                                    onClick={() => setAgendando(l)}>
                                    <CalendarPlus className="mr-1 h-3 w-3" aria-hidden /> Reagendar
                                  </Button>
                                )}
                                {coluna === 'reuniao_realizada' && (
                                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={agindo}
                                    onClick={() => void mover(l, 'qualificada')}>
                                    Qualificada <ChevronRight className="ml-0.5 h-3 w-3" aria-hidden />
                                  </Button>
                                )}
                                {/* Julgar fit: disponível de em_conversa em diante. */}
                                {coluna !== 'a_contatar' && l.fit !== true && (
                                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={agindo}
                                    onClick={() => void julgar(l, true)}>
                                    Com fit
                                  </Button>
                                )}
                                {coluna !== 'a_contatar' && (
                                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={agindo}
                                    onClick={() => setSemFit(l)}>
                                    Sem fit
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                      {itens.length === 0 && (
                        <p className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                          vazio
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Estágio</TableHead>
                    <TableHead>Fit</TableHead>
                    <TableHead className="text-right">Esperado/mês</TableHead>
                    <TableHead>SDR</TableHead>
                    <TableHead>Reunião</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="max-w-[20rem]">
                        <Link
                          href={l.empresas ? `/empresas/${l.empresas.id}` : '#'}
                          className="text-sm font-medium hover:underline"
                        >
                          {l.empresas?.razao_social ?? 'Empresa'}
                        </Link>
                        <p className="text-xs text-muted-foreground">{l.empresas?.uf ?? '—'}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="whitespace-nowrap text-[11px]">
                          {ESTAGIO_SDR_LABELS[l.estagio as EstagioSdr] ?? l.estagio}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{rotuloFit(l.fit)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {brl(l.empresas?.valor_esperado_mensal)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {nomePorId.get(l.sdr_id) ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        {l.reuniao_em ? new Date(l.reuniao_em).toLocaleString('pt-BR', {
                          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                        }) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Agendar ── */}
      <Dialog open={agendando !== null} onOpenChange={(v) => !v && setAgendando(null)}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!agendando) return
              const fd = new FormData(e.currentTarget)
              const quando = String(fd.get('quando') ?? '')
              const destino = String(fd.get('destino') ?? '')
              // datetime-local vem sem fuso; o banco quer ISO com offset.
              const iso = quando ? new Date(quando).toISOString() : ''
              const ok = await mover(agendando, 'reuniao_agendada', {
                reuniao_em: iso,
                vendedor_destino_id: destino,
              })
              if (ok) setAgendando(null)
            }}
          >
            <DialogHeader>
              <DialogTitle>Agendar reunião</DialogTitle>
              <DialogDescription>
                Cria o card no funil do closer e o evento no calendário dos dois. O closer vê a
                reunião como sua no mesmo instante.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="quando">Quando</Label>
                <Input id="quando" name="quando" type="datetime-local" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="destino">Vendedor destino</Label>
                <select
                  id="destino"
                  name="destino"
                  required
                  defaultValue={sugestao?.vendedor_id ?? ''}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione…</option>
                  {closers.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nome}
                      {sugestao?.vendedor_id === v.id ? ' — sugerido pelo território' : ''}
                      {sugestao?.vendedor_id !== v.id
                        ? ` · ${TIPO_VENDEDOR_LABELS[v.tipo as TipoVendedorId] ?? v.tipo}`
                        : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {sugestao
                    ? sugestao.motivo
                    : 'Nenhum closer cobre esta UF e faixa de faturamento — escolha à mão.'}
                </p>
                {closers.length === 0 && (
                  <p className="text-xs text-destructive">
                    Nenhum closer cadastrado — cadastre um vendedor em Configurações.
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAgendando(null)}>Cancelar</Button>
              <Button type="submit" disabled={agindo || closers.length === 0}>Agendar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Sem fit ── */}
      <Dialog open={semFit !== null} onOpenChange={(v) => !v && setSemFit(null)}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!semFit) return
              const motivo = String(new FormData(e.currentTarget).get('motivo') ?? '')
              const ok = await julgar(semFit, false, motivo)
              if (ok) setSemFit(null)
            }}
          >
            <DialogHeader>
              <DialogTitle>Marcar sem fit</DialogTitle>
              <DialogDescription>
                Encerra o lead <strong>onde ele está</strong> — o card não muda de coluna, e é
                isso que diz até onde ele chegou antes de morrer. O motivo é obrigatório e vira
                estatística: é ele que diz se a régua do Mercado traz empresa errada, e por quê.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="motivo">Motivo</Label>
              <select
                id="motivo"
                name="motivo"
                required
                className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione…</option>
                {(motivos.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.motivo}</option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSemFit(null)}>Cancelar</Button>
              <Button type="submit" variant="destructive" disabled={agindo}>Marcar sem fit</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
