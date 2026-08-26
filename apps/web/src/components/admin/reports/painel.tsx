'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { LayoutGrid, Search, Table2 } from 'lucide-react'
import {
  PRIORIDADES_REPORT,
  PRIORIDADE_REPORT_LABELS,
  STATUS_REPORT,
  STATUS_REPORT_LABELS,
  TIPOS_REPORT,
  TIPO_REPORT_LABELS,
  statusDoTipo,
  type StatusReport,
  type TipoReport,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { Numero, PrioridadeBadge, StatusBadge, TipoIcone } from '@/components/reports/badges'
import {
  FILTRO_REPORTS_PADRAO,
  buscarAutoresDeReports,
  buscarPainelReports,
  buscarReport,
  buscarReports,
  reportsKeys,
  type FiltroReports,
  type Report,
} from '@/components/reports/queries'
import { DetalheReport } from './detalhe'

const dia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })

const ROTA = '/admin/reports'

/**
 * A triagem de reports (04m §3).
 *
 * A FORMA É A MESMA dos funis do Comercial — um cartão só, kanban por status,
 * tabela como alternativa, filtros no canto direito do cabeçalho. Não é cosmético:
 * quem administra também vende, e reaprender a ler a tela a cada troca de módulo
 * é um custo que nenhuma dessas telas precisa cobrar.
 */
export function PainelReports() {
  const params = useSearchParams()
  const router = useRouter()
  const [vista, setVista] = React.useState<'kanban' | 'tabela'>('tabela')
  const [filtro, setFiltro] = React.useState<FiltroReports>(FILTRO_REPORTS_PADRAO)
  const [termo, setTermo] = React.useState('')
  const [abertoId, setAbertoId] = React.useState<string | null>(null)

  // Debounce: cada tecla no campo de busca é uma consulta, e a lista é a tabela
  // inteira filtrada por `ilike`.
  React.useEffect(() => {
    const t = setTimeout(() => setFiltro((f) => ({ ...f, termo })), 300)
    return () => clearTimeout(t)
  }, [termo])

  const lista = useQuery({
    queryKey: reportsKeys.lista(JSON.stringify(filtro)),
    queryFn: () => buscarReports(filtro),
  })
  const painel = useQuery({ queryKey: reportsKeys.painel(), queryFn: buscarPainelReports })
  const autores = useQuery({ queryKey: ['reports', 'autores'], queryFn: buscarAutoresDeReports })

  const reports = React.useMemo(() => lista.data ?? [], [lista.data])

  /*
   * O sino do admin aponta para `/admin/reports?r=<id>` — abrir o report que
   * chegou é o único motivo de ele ter clicado.
   *
   * O parâmetro é CONSUMIDO: ao abrir, a URL é reescrita sem ele. Sem isso o
   * modal reabriria a cada re-render depois de o admin fechá-lo, e uma segunda
   * notificação não abriria nada — um `useRef` booleano resolveria o primeiro
   * problema e criaria o segundo.
   */
  const doLink = params.get('r')
  React.useEffect(() => {
    if (!doLink) return
    setAbertoId(doLink)
    router.replace(ROTA, { scroll: false })
  }, [doLink, router])

  /*
   * O report do link pode não estar na lista: o filtro abre em "abertos e em
   * andamento", e um report já resolvido não estaria lá. Buscá-lo à parte é o
   * que impede o clique na notificação de abrir um modal vazio.
   */
  const doLinkQuery = useQuery({
    queryKey: reportsKeys.um(abertoId ?? ''),
    queryFn: () => buscarReport(abertoId as string),
    enabled: abertoId !== null && !reports.some((r) => r.id === abertoId),
  })

  const aberto = reports.find((r) => r.id === abertoId) ?? doLinkQuery.data ?? null

  return (
    <div className="space-y-4">
      <Contadores
        carregando={painel.isPending}
        abertos={painel.data?.abertos ?? 0}
        emAndamento={painel.data?.em_andamento ?? 0}
        resolvidosMes={painel.data?.resolvidos_mes ?? 0}
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            {/* `min-w-0 flex-1`: sem eles a descrição não encolhe, o grupo de
                controles não cabe na linha e desce alinhado à esquerda. */}
            <div className="min-w-0 flex-1 space-y-1.5">
              <CardTitle className="text-base">Reports</CardTitle>
              <CardDescription>
                {reports.length} na lista. Bugs e melhorias correm em esteiras
                diferentes — o seletor de status só oferece a do tipo de cada report.
              </CardDescription>
            </div>

            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  placeholder="Texto ou #42…"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  className="h-9 w-40 pl-7"
                  aria-label="Buscar reports"
                />
              </div>

              <Select
                value={filtro.tipo}
                onValueChange={(v) => setFiltro((f) => ({ ...f, tipo: v as FiltroReports['tipo'] }))}
              >
                <SelectTrigger className="h-9 w-32" aria-label="Tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os tipos</SelectItem>
                  {TIPOS_REPORT.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIPO_REPORT_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filtro.status}
                onValueChange={(v) =>
                  setFiltro((f) => ({ ...f, status: v as FiltroReports['status'] }))
                }
              >
                <SelectTrigger className="h-9 w-44" aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="abertos_e_andamento">Abertos e em andamento</SelectItem>
                  <SelectItem value="todos">Todos os status</SelectItem>
                  {/* Só os status do tipo filtrado. Com "todos os tipos" a lista é a
                      união — oferecer "Em correção" para uma melhoria devolveria zero. */}
                  {(filtro.tipo === 'todos'
                    ? STATUS_REPORT
                    : statusDoTipo(filtro.tipo as TipoReport)
                  ).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_REPORT_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filtro.prioridade}
                onValueChange={(v) =>
                  setFiltro((f) => ({ ...f, prioridade: v as FiltroReports['prioridade'] }))
                }
              >
                <SelectTrigger className="h-9 w-36" aria-label="Prioridade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Toda prioridade</SelectItem>
                  {PRIORIDADES_REPORT.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORIDADE_REPORT_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filtro.autorId}
                onValueChange={(v) => setFiltro((f) => ({ ...f, autorId: v }))}
              >
                <SelectTrigger className="h-9 w-40" aria-label="Autor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os autores</SelectItem>
                  {(autores.data ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filtro.ordem}
                onValueChange={(v) =>
                  setFiltro((f) => ({ ...f, ordem: v as FiltroReports['ordem'] }))
                }
              >
                <SelectTrigger className="h-9 w-36" aria-label="Ordenação">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="data">Mais recentes</SelectItem>
                  <SelectItem value="prioridade">Por prioridade</SelectItem>
                </SelectContent>
              </Select>

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
          {lista.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : reports.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nada por aqui.</p>
              <p className="mt-1">
                {filtro.status === 'abertos_e_andamento'
                  ? 'Nenhum report aberto ou em andamento com esses filtros. Troque para "Todos os status" para ver os fechados.'
                  : 'Nenhum report com esses filtros.'}
              </p>
            </div>
          ) : vista === 'kanban' ? (
            <Kanban reports={reports} tipo={filtro.tipo} onAbrir={setAbertoId} />
          ) : (
            <Tabela reports={reports} onAbrir={setAbertoId} />
          )}
        </CardContent>
      </Card>

      <DetalheReport report={aberto} onOpenChange={(v) => !v && setAbertoId(null)} />
    </div>
  )
}

function Contadores({
  carregando,
  abertos,
  emAndamento,
  resolvidosMes,
}: {
  carregando: boolean
  abertos: number
  emAndamento: number
  resolvidosMes: number
}) {
  /*
   * Os números vêm de `reports_painel()`, não da lista na tela.
   *
   * A lista tem limite de página e vem filtrada; contar sobre ela diria "3
   * abertos" com 40 abertos no banco, e um contador errado no topo de uma tela
   * de triagem é pior que nenhum contador.
   */
  const itens = [
    { rotulo: 'Abertos', valor: abertos, dica: 'Chegaram e ainda não foram triados.' },
    { rotulo: 'Em andamento', valor: emAndamento, dica: 'Alguém está trabalhando neles.' },
    {
      rotulo: 'Resolvidos no mês',
      valor: resolvidosMes,
      dica: 'Corrigidos ou entregues. Arquivar sem fazer não conta.',
    },
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {itens.map((i) => (
        <Card key={i.rotulo}>
          <CardContent className="space-y-0.5 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{i.rotulo}</p>
            {carregando ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums">{i.valor}</p>
            )}
            <p className="text-xs text-muted-foreground">{i.dica}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function Tabela({ reports, onAbrir }: { reports: Report[]; onAbrir: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">#</TableHead>
            <TableHead>Título</TableHead>
            <TableHead className="w-40">Status</TableHead>
            <TableHead className="w-28">Prioridade</TableHead>
            <TableHead className="w-40">Autor</TableHead>
            <TableHead className="w-20">Criado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.map((r) => (
            <TableRow
              key={r.id}
              tabIndex={0}
              role="button"
              className="cursor-pointer"
              onClick={() => onAbrir(r.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onAbrir(r.id)
                }
              }}
            >
              <TableCell>
                <Numero numero={r.numero} />
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <TipoIcone tipo={r.tipo} />
                  <span className="min-w-0 truncate">{r.titulo}</span>
                </span>
              </TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
              </TableCell>
              <TableCell>
                <PrioridadeBadge prioridade={r.prioridade} />
              </TableCell>
              <TableCell className="truncate text-sm text-muted-foreground">
                {r.autor_nome ?? '—'}
              </TableCell>
              <TableCell className="text-xs tabular-nums text-muted-foreground">
                {dia.format(new Date(r.criado_em))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function Kanban({
  reports,
  tipo,
  onAbrir,
}: {
  reports: Report[]
  tipo: FiltroReports['tipo']
  onAbrir: (id: string) => void
}) {
  /*
   * As colunas são a esteira do TIPO filtrado. Com "todos os tipos" são as dez da
   * união, na ordem em que as duas esteiras andam — e não uma esteira escolhida
   * por nós: forçar o tipo ao trocar de vista mudaria a lista sem que ninguém
   * tivesse pedido, que é a forma mais rápida de alguém achar que sumiram cards.
   */
  const colunas = tipo === 'todos' ? STATUS_REPORT : statusDoTipo(tipo as TipoReport)

  const porStatus = React.useMemo(() => {
    const m = new Map<string, Report[]>()
    for (const r of reports) {
      const l = m.get(r.status) ?? []
      l.push(r)
      m.set(r.status, l)
    }
    return m
  }, [reports])

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {colunas.map((coluna) => {
        const itens = porStatus.get(coluna) ?? []
        return (
          <div key={coluna} className="w-64 shrink-0 space-y-2">
            <div className="flex items-baseline justify-between gap-2 border-b pb-1">
              <p className="text-xs font-medium">{STATUS_REPORT_LABELS[coluna]}</p>
              <span className="text-xs tabular-nums text-muted-foreground">{itens.length}</span>
            </div>
            <div className="space-y-2">
              {itens.map((r) => (
                <div
                  key={r.id}
                  className={cn(
                    'relative space-y-1.5 rounded-md border p-2 text-sm transition-colors',
                    'hover:border-foreground/25 focus-within:ring-1 focus-within:ring-ring',
                    r.prioridade === 'critica' && 'border-destructive/40 bg-destructive/5',
                  )}
                >
                  {/* <button> esticado, e não onClick no <div>: é o que mantém
                      teclado e leitor de tela funcionando. */}
                  <button
                    type="button"
                    aria-label={`Abrir report #${r.numero}`}
                    onClick={() => onAbrir(r.id)}
                    className="absolute inset-0 z-0 rounded-md focus:outline-none"
                  />
                  <p className="flex items-center gap-1.5">
                    <TipoIcone tipo={r.tipo} />
                    <Numero numero={r.numero} />
                  </p>
                  <p className="line-clamp-3">{r.titulo}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PrioridadeBadge prioridade={r.prioridade} />
                    <span className="text-[11px] text-muted-foreground">
                      {r.autor_nome ?? '—'} · {dia.format(new Date(r.criado_em))}
                    </span>
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
  )
}
