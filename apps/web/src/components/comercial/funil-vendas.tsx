'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, LayoutGrid, RotateCcw, Table2, ThumbsDown, ThumbsUp } from 'lucide-react'
import {
  ESTAGIOS_VENDA, ESTAGIO_VENDA_LABELS, SITUACAO_VENDA_LABELS, vendaNoFunil,
  type EstagioVenda, type SituacaoVenda,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { atribuirVendaAction, moverVendaAction } from '@/actions/comercial'
import { cn } from '@/lib/utils'
import { AbaEmpresa } from './aba-empresa'
import { DonoDoCard } from './dono-do-card'
import { AbaMensagens, ModalDoCard } from './modal-card'
import { EtapasDoFunil } from './etapas-funil'
import {
  buscarMotivos, buscarVendas, buscarVendedores, buscarVendedoresVisiveis, comercialKeys,
  type VendaComEmpresa,
} from './queries'

/**
 * Funil do closer — mesma forma da esteira de crédito (04d §4.4): um cartão só, kanban
 * por estágio, tabela como alternativa.
 *
 * A forma é a mesma porque a pergunta é a mesma — "onde está cada coisa, e o que falta
 * nela" — e duas telas que respondem à mesma pergunta com layouts diferentes obrigam a
 * pessoa a reaprender a ler a cada troca de módulo.
 *
 * NÃO tem arrastar-e-soltar, pelo mesmo motivo da esteira: perder exige motivo, e um
 * gesto de arrastar que abre um diálogo obrigatório é pior que um botão.
 *
 * O ESTÁGIO diz onde o negócio está; GANHO e PERDIDO são situação, e não movem o card.
 * Um negócio ganho pode estar em onboarding — e é lá que o trabalho continua. Como
 * coluna, "ganho" tirava o card da etapa onde o trabalho acontece justamente quando ele
 * passou a exigir trabalho de verdade. Ganho CONTINUA no funil até a primeira operação;
 * depois dela some sozinho, porque rotina não mora em funil.
 *
 * `em_analise_credito` não avança por clique: quem move é a decisão da seguradora (04d).
 * Aprovada vai para proposta, negada encerra onde está, parcial fica parada de propósito.
 */

/** O tom do card conta a situação antes de qualquer leitura — como na esteira. */
const SITUACAO_CLASSE: Record<SituacaoVenda, string> = {
  em_andamento: '',
  ganho: 'border-emerald-500/40 bg-emerald-500/5',
  perdido: 'border-destructive/40 bg-destructive/5',
}

/** O próximo passo natural. Null = não se avança daqui por clique. */
function proximo(e: EstagioVenda): EstagioVenda | null {
  if (e === 'em_analise_credito') return null
  const i = ESTAGIOS_VENDA.indexOf(e)
  return i >= 0 && i < ESTAGIOS_VENDA.length - 1 ? (ESTAGIOS_VENDA[i + 1] as EstagioVenda) : null
}

export function FunilVendas({ ehGestor }: { ehGestor: boolean }) {
  const qc = useQueryClient()
  const [vendedorId, setVendedorId] = React.useState<string | null>(null)
  const [vista, setVista] = React.useState<'kanban' | 'tabela'>('kanban')
  const [perdendo, setPerdendo] = React.useState<VendaComEmpresa | null>(null)
  const [aberto, setAberto] = React.useState<VendaComEmpresa | null>(null)
  const [agindo, setAgindo] = React.useState(false)
  // Fora do funil = perdido, ou ganho que já operou. Escondidos por padrão: o kanban é
  // a fila de trabalho, e nenhum dos dois pede trabalho.
  const [mostrarEncerrados, setMostrarEncerrados] = React.useState(false)

  const vendedores = useQuery({ queryKey: comercialKeys.vendedores(), queryFn: buscarVendedores })
  // Quem eu posso ABRIR — não é a mesma lista de quem existe. O seletor sai daqui para
  // não oferecer um funil que a RLS devolveria vazio.
  const alcance = useQuery({ queryKey: comercialKeys.visiveis(), queryFn: buscarVendedoresVisiveis })
  const vendas = useQuery({ queryKey: comercialKeys.vendas(vendedorId), queryFn: () => buscarVendas(vendedorId) })
  const motivos = useQuery({
    queryKey: comercialKeys.motivos('funil_vendedor'),
    queryFn: () => buscarMotivos('funil_vendedor'),
  })

  // Gestor sempre vê o seletor: para ele "todos" é uma informação, não um default
  // silencioso. Vendedor comum só vê quando há realmente mais de um funil ao alcance.
  const closersVisiveis = (alcance.data ?? []).filter((v) => v.tipo === 'vendedor')
  const mostrarSeletor = ehGestor || closersVisiveis.length > 1
  const nomePorId = new Map((vendedores.data ?? []).map((v) => [v.id, v.nome]))

  async function reatribuir(v: VendaComEmpresa, destino: string) {
    setAgindo(true)
    const r = await atribuirVendaAction({ venda_id: v.id, vendedor_id: destino })
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`Negócio agora é de ${nomePorId.get(destino) ?? 'outro vendedor'}.`)
    void qc.invalidateQueries({ queryKey: ['comercial'] })
  }

  async function mover(v: VendaComEmpresa, estagio: EstagioVenda) {
    setAgindo(true)
    const r = await moverVendaAction({ venda_id: v.id, estagio })
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success(`Movido para ${ESTAGIO_VENDA_LABELS[estagio]}.`)
    setAberto(null)
    void qc.invalidateQueries({ queryKey: ['comercial'] })
    return true
  }

  /** Ganhar ou perder. NÃO move o card — o estágio diz onde o negócio está. */
  async function encerrar(v: VendaComEmpresa, situacao: SituacaoVenda, motivo?: string) {
    setAgindo(true)
    const r = await moverVendaAction({
      venda_id: v.id,
      situacao,
      perdido_motivo: motivo ?? null,
    })
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success(
      situacao === 'ganho'
        ? 'Venda ganha — a empresa virou cliente. Falta definir se a conta será ativa ou passiva na ficha dela.'
        : situacao === 'perdido'
          ? 'Venda perdida. O card fica onde estava, e é isso que diz até onde ela chegou.'
          : 'Negócio reaberto.',
    )
    setAberto(null)
    void qc.invalidateQueries({ queryKey: ['comercial'] })
    return true
  }

  if (vendas.isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  if (vendas.isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {vendas.error instanceof Error ? vendas.error.message : 'Erro ao carregar o funil.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const todas = vendas.data ?? []
  const visiveis = todas.filter((v) => mostrarEncerrados || vendaNoFunil(v))
  const foraDoFunil = todas.filter((v) => !vendaNoFunil(v)).length

  const porEstagio = new Map<string, VendaComEmpresa[]>()
  for (const v of visiveis) porEstagio.set(v.estagio, [...(porEstagio.get(v.estagio) ?? []), v])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Funil de Vendas</CardTitle>
              <CardDescription>
                {visiveis.length} negócio(s). <strong>Ganho e perdido são situação, não
                coluna</strong> — o card fica onde está, e é o estágio que diz até onde ele
                chegou. Ganho só sai do funil na primeira operação do cliente.
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {foraDoFunil > 0 && (
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={mostrarEncerrados}
                    onChange={(e) => setMostrarEncerrados(e.target.checked)}
                  />
                  Mostrar {foraDoFunil} fora do funil
                </label>
              )}
              {mostrarSeletor && (
                <Select value={vendedorId ?? 'todos'} onValueChange={(v) => setVendedorId(v === 'todos' ? null : v)}>
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder="Todos os vendedores" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os vendedores</SelectItem>
                    {closersVisiveis.map((v) => (
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
          {todas.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nenhum negócio ainda.</p>
              <p className="mt-1">
                As vendas nascem quando um SDR agenda a reunião — o card cai aqui já no funil
                do closer destino.
              </p>
            </div>
          ) : vista === 'kanban' ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {ESTAGIOS_VENDA.map((coluna) => {
                const itens = porEstagio.get(coluna) ?? []
                const seguinte = proximo(coluna)
                return (
                  <div key={coluna} className="w-64 shrink-0 space-y-2">
                    <div className="flex items-baseline justify-between gap-2 border-b pb-1">
                      <p className="text-xs font-medium">{ESTAGIO_VENDA_LABELS[coluna]}</p>
                      <span className="text-xs tabular-nums text-muted-foreground">{itens.length}</span>
                    </div>
                    <div className="space-y-2">
                      {itens.map((v) => (
                        <div
                          key={v.id}
                          className={cn(
                            'relative space-y-1.5 rounded-md border p-2 text-sm transition-colors',
                            'hover:border-foreground/25 focus-within:ring-1 focus-within:ring-ring',
                            SITUACAO_CLASSE[v.situacao as SituacaoVenda],
                            v.primeira_operacao_em && 'opacity-70',
                          )}
                        >
                          {/*
                           * O card INTEIRO abre o negócio, e a área clicável é um <button>
                           * de verdade esticado sobre ele — não um onClick no <div>.
                           *
                           * A diferença aparece em tudo que não é mouse: o botão entra na
                           * ordem de tabulação, responde a Enter e Espaço, e é anunciado
                           * como "Abrir {empresa}" em vez de silêncio. Um div com onClick
                           * dá a mesma área e nada disso.
                           *
                           * O nome deixou de ser link para a empresa: dois destinos no
                           * mesmo card fazem o clique virar loteria. A empresa continua a
                           * um clique, na aba do modal.
                           */}
                          <button
                            type="button"
                            aria-label={`Abrir ${v.empresas?.razao_social ?? 'negócio'}`}
                            onClick={() => setAberto(v)}
                            className="absolute inset-0 z-0 rounded-md focus:outline-none"
                          />
                          <p className="line-clamp-2 font-medium">
                            {v.empresas?.razao_social ?? 'Empresa'}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {v.empresas?.uf ? (
                              <Badge variant="outline" className="text-[10px]">{v.empresas.uf}</Badge>
                            ) : null}
                            {/* Situação no card, não na coluna: o negócio tem as duas coisas. */}
                            {v.situacao !== 'em_andamento' ? (
                              <Badge
                                variant={v.situacao === 'perdido' ? 'destructive' : 'default'}
                                className={cn(
                                  'text-[10px]',
                                  v.situacao === 'ganho' &&
                                    'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
                                )}
                              >
                                {SITUACAO_VENDA_LABELS[v.situacao as SituacaoVenda]}
                              </Badge>
                            ) : null}
                            {v.primeira_operacao_em ? (
                              <Badge variant="secondary" className="text-[10px]">Já operando</Badge>
                            ) : null}
                          </div>
                          {/* Só sem filtro: com ele o nome repetiria em cada card o
                              que o seletor no topo já diz. */}
                          {!vendedorId && (
                            // `z-10`: o seletor de dono é interativo e precisa ficar ACIMA
                            // da área que abre o card, senão trocar de dono viraria abrir.
                            <div className="relative z-10">
                            <DonoDoCard
                              nome={nomePorId.get(v.vendedor_id) ?? null}
                              tipos={['vendedor']}
                              podeTrocar={ehGestor}
                              ocupado={agindo}
                              onTrocar={(id) => reatribuir(v, id)}
                            />
                            </div>
                          )}
                          {coluna === 'em_analise_credito' && v.situacao === 'em_andamento' && (
                            <p className="text-[11px] text-muted-foreground">
                              Aguardando a seguradora. O card anda sozinho quando ela decidir.
                            </p>
                          )}
                          {v.situacao === 'ganho' && !v.primeira_operacao_em && (
                            <p className="text-[11px] text-muted-foreground">
                              Ganho, sem operar ainda — sai do funil na primeira antecipação.
                            </p>
                          )}
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
                    <TableHead>Situação</TableHead>
                    <TableHead>Vendedor</TableHead>
                    <TableHead>Atualizada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="max-w-[20rem]">
                        <Link
                          href={v.empresas ? `/empresas/${v.empresas.id}` : '#'}
                          className="text-sm font-medium hover:underline"
                        >
                          {v.empresas?.razao_social ?? 'Empresa'}
                        </Link>
                        <p className="text-xs text-muted-foreground">{v.empresas?.uf ?? '—'}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="whitespace-nowrap text-[11px]">
                          {ESTAGIO_VENDA_LABELS[v.estagio as EstagioVenda] ?? v.estagio}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {SITUACAO_VENDA_LABELS[v.situacao as SituacaoVenda] ?? v.situacao}
                        {v.primeira_operacao_em ? ' · já operando' : ''}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {nomePorId.get(v.vendedor_id) ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        {new Date(v.atualizada_em).toLocaleDateString('pt-BR')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/*
        O modal do card. As ações que estavam no card vivem no rodapé dele; o diálogo
        de perda continua separado porque exige motivo, e empilhar um formulário
        obrigatório dentro de outro modal esconde o campo que decide.
      */}
      {aberto && (
        <ModalDoCard
          aberto
          onOpenChange={(o) => !o && setAberto(null)}
          titulo={aberto.empresas?.razao_social ?? 'Negócio'}
          subtitulo={ESTAGIO_VENDA_LABELS[aberto.estagio as EstagioVenda] ?? aberto.estagio}
          cabecalho={
            <div className="flex flex-wrap items-center gap-2">
              {aberto.empresas?.uf ? <Badge variant="outline">{aberto.empresas.uf}</Badge> : null}
              {aberto.situacao !== 'em_andamento' ? (
                <Badge variant={aberto.situacao === 'perdido' ? 'destructive' : 'default'}>
                  {SITUACAO_VENDA_LABELS[aberto.situacao as SituacaoVenda]}
                </Badge>
              ) : null}
              <DonoDoCard
                nome={nomePorId.get(aberto.vendedor_id) ?? null}
                tipos={['vendedor']}
                podeTrocar={ehGestor}
                ocupado={agindo}
                onTrocar={(id) => reatribuir(aberto, id)}
              />
            </div>
          }
          etapas={
            <EtapasDoFunil
              etapas={ESTAGIOS_VENDA.map((e) => ({
                id: e,
                label: ESTAGIO_VENDA_LABELS[e],
                // Perdido não anda: o estágio é o que registra até onde o negócio chegou
                // antes de morrer, e movê-lo apagaria essa informação. Reabrir primeiro.
                bloqueada:
                  aberto.situacao === 'perdido' ? 'negócio perdido — reabra para mover' : undefined,
              }))}
              atual={aberto.estagio}
              ocupado={agindo}
              onIr={(id) => void mover(aberto, id as EstagioVenda)}
            />
          }
          abas={[
            {
              id: 'negocio',
              label: 'Negócio',
              conteudo: (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    Estágio: <strong className="text-foreground">
                      {ESTAGIO_VENDA_LABELS[aberto.estagio as EstagioVenda] ?? aberto.estagio}
                    </strong>
                  </p>
                  {aberto.primeira_operacao_em ? (
                    <p className="text-muted-foreground">
                      Já operando desde {new Date(aberto.primeira_operacao_em).toLocaleDateString('pt-BR')}.
                    </p>
                  ) : null}
                  {aberto.estagio === 'em_analise_credito' && aberto.situacao === 'em_andamento' ? (
                    <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      Aguardando a seguradora. O card anda sozinho quando ela decidir — não há
                      botão de avançar aqui de propósito.
                    </p>
                  ) : null}
                  {aberto.situacao === 'ganho' && !aberto.primeira_operacao_em ? (
                    <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      Ganho, sem operar ainda — sai do funil na primeira antecipação.
                    </p>
                  ) : null}
                </div>
              ),
            },
            { id: 'empresa', label: 'Empresa', conteudo: <AbaEmpresa empresaId={aberto.empresas?.id ?? null} /> },
            { id: 'mensagens', label: 'Mensagens', conteudo: <AbaMensagens /> },
          ]}
          /*
           * Ganhar e perder são as duas decisões terminais, e ficam lado a lado no topo
           * com as cores que o resto do sistema já usa para isso: verde de aprovação
           * (o mesmo do badge "ganho" no card) e o destrutivo do tema.
           *
           * Avançar saiu daqui — virou a trilha de etapas acima, que faz o mesmo e mais.
           */
          acoes={
            aberto.situacao === 'perdido' ? (
              <Button size="sm" variant="outline" disabled={agindo} onClick={() => void encerrar(aberto, 'em_andamento')}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />
                Reabrir
              </Button>
            ) : aberto.situacao === 'em_andamento' ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={agindo}
                  onClick={() => setPerdendo(aberto)}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <ThumbsDown className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Perdi
                </Button>
                <Button
                  size="sm"
                  disabled={agindo}
                  onClick={() => void encerrar(aberto, 'ganho')}
                  className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  <ThumbsUp className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Ganhei
                </Button>
              </>
            ) : null
          }
        />
      )}

      <Dialog open={perdendo !== null} onOpenChange={(v) => !v && setPerdendo(null)}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!perdendo) return
              const motivo = String(new FormData(e.currentTarget).get('motivo') ?? '')
              const ok = await encerrar(perdendo, 'perdido', motivo)
              // Fecha os dois: o diálogo de motivo e o modal do card que o abriu.
              if (ok) {
                setPerdendo(null)
                setAberto(null)
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Marcar como perdida</DialogTitle>
              <DialogDescription>
                O card fica <strong>onde está</strong> — é o estágio que diz até onde a venda
                chegou antes de morrer. O motivo é obrigatório: é a única coisa que sobra de
                uma venda perdida, e a única que responde &quot;por que estamos perdendo?&quot;
                três meses depois.
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
              <Button type="button" variant="outline" onClick={() => setPerdendo(null)}>Cancelar</Button>
              <Button type="submit" variant="destructive" disabled={agindo}>Marcar perdida</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
