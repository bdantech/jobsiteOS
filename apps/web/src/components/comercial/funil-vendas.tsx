'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  LayoutGrid,
  RotateCcw,
  Table2,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
} from 'lucide-react'
import {
  ESTAGIOS_VENDA, ESTAGIO_ANALISE_LABELS, ESTAGIO_VENDA_LABELS, SITUACAO_VENDA_LABELS,
  vendaNoFunil,
  type EstagioAnalise, type EstagioVenda, type SituacaoVenda,
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
import { AbaEmpresa } from './aba-empresa'
import { AbaReuniao } from './aba-reuniao'
import {
  AbaFormulario,
  ChipsDaEmpresa,
  ValorDaEmpresa,
  ehInbound,
  scoreDaEmpresa,
  textoDoScore,
} from './ficha-do-card'
import {
  CabecalhoDaColuna,
  CardDoFunil,
  ChipDoCard,
  ColunaVazia,
  DonoNoRodape,
  TiraDoCard,
} from './card-funil'
import { DonoDoCard } from './dono-do-card'
import { AbaMensagens, ModalDoCard } from './modal-card'
import { EtapasDoFunil } from './etapas-funil'
import { AbaCredito } from './aba-credito'
import { AbaNotas } from './aba-notas'
import {
  buscarMotivos, buscarVendas, buscarVendedores, buscarVendedoresVisiveis, comercialKeys,
  haOutroAoAlcance,
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
const BRL_CARD = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

function proximo(e: EstagioVenda): EstagioVenda | null {
  if (e === 'em_analise_credito') return null
  const i = ESTAGIOS_VENDA.indexOf(e)
  return i >= 0 && i < ESTAGIOS_VENDA.length - 1 ? (ESTAGIOS_VENDA[i + 1] as EstagioVenda) : null
}

export function FunilVendas({ ehGestor, temCredito = false }: { ehGestor: boolean; temCredito?: boolean }) {
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

  /*
   * Gestor sempre vê o seletor: para ele "todos" é uma informação, não um default
   * silencioso. Para os outros, a régua é HÁ ALGUÉM ALÉM DE MIM AO ALCANCE — e não
   * "há mais de um closer na lista", que escondia o filtro de quem tem acesso cruzado
   * a exatamente um funil. Ver `haOutroAoAlcance`.
   */
  const closersVisiveis = (alcance.data ?? []).filter((v) => v.tipo === 'vendedor')
  const mostrarSeletor = ehGestor || (haOutroAoAlcance(alcance.data) && closersVisiveis.length > 0)
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
              <Button variant="outline" size="sm" asChild>
                <Link href="/comercial/analise">
                  <TrendingDown className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Análise
                </Link>
              </Button>
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
            <div className="flex gap-5 overflow-x-auto pb-3">
              {ESTAGIOS_VENDA.map((coluna) => {
                const itens = porEstagio.get(coluna) ?? []
                const seguinte = proximo(coluna)
                return (
                  <div key={coluna} className="w-[300px] shrink-0 space-y-3">
                    <CabecalhoDaColuna titulo={ESTAGIO_VENDA_LABELS[coluna]} total={itens.length} />
                    <div className="space-y-3">
                      {itens.map((v) => (
                        <CardDoFunil
                          key={v.id}
                          rotuloAbrir={`Abrir ${v.empresas?.razao_social ?? 'negócio'}`}
                          onAbrir={() => setAberto(v)}
                          esmaecido={Boolean(v.primeira_operacao_em)}
                          className={SITUACAO_CLASSE[v.situacao as SituacaoVenda]}
                          titulo={v.empresas?.razao_social ?? 'Empresa'}
                          valor={<ValorDaEmpresa empresa={v.empresas} />}
                          score={scoreDaEmpresa(v.empresas)}
                          chips={
                            <>
                              <ChipsDaEmpresa
                                empresa={v.empresas}
                                uf={v.empresas?.uf}
                                origem={ehInbound(v) ? 'inbound' : 'outbound'}
                              />
                              {/* Situação no card, não na coluna: o negócio tem as duas coisas. */}
                              {v.situacao !== 'em_andamento' ? (
                                <ChipDoCard tom={v.situacao === 'perdido' ? 'neutro' : 'destaque'} forte>
                                  {SITUACAO_VENDA_LABELS[v.situacao as SituacaoVenda]}
                                </ChipDoCard>
                              ) : null}
                              {v.primeira_operacao_em ? <ChipDoCard>Já operando</ChipDoCard> : null}
                            </>
                          }
                          rodapeEsquerda={
                            !vendedorId ? (
                              // `z-10`: trocar de dono é interativo e precisa ficar ACIMA
                              // do botão que abre o card, senão trocar viraria abrir.
                              <span className="relative z-10 block">
                                <DonoDoCard
                                  nome={nomePorId.get(v.vendedor_id) ?? null}
                                  tipos={['vendedor']}
                                  podeTrocar={ehGestor}
                                  ocupado={agindo}
                                  onTrocar={(id) => reatribuir(v, id)}
                                />
                              </span>
                            ) : (
                              <DonoNoRodape nome={nomePorId.get(v.vendedor_id) ?? null} />
                            )
                          }
                          rodapeDireita={textoDoScore(v.empresas)}
                          tira={
                            /*
                              UMA tira, e nesta ordem de prioridade. O limite aprovado é o
                              número que decide se vale seguir; a negativa é o único fato
                              que vale mais que ele. Empilhar as duas faria um card
                              decidido parecer indeciso.

                              A RECUSA ESTAVA FALTANDO no card antigo: um negócio negado
                              ficava visualmente igual a um que ninguém analisou, e a
                              diferença entre os dois é a única que importa nessa coluna.
                            */
                            v.analises_credito?.estagio === 'negada' ? (
                              <TiraDoCard tom="ruim">
                                Crédito negado
                                {v.analises_credito.motivo ? (
                                  <span className="block font-normal opacity-80 line-clamp-2">
                                    {v.analises_credito.motivo}
                                  </span>
                                ) : null}
                              </TiraDoCard>
                            ) : v.analises_credito?.limite_aprovado ? (
                              <TiraDoCard tom="bom">
                                {BRL_CARD.format(Number(v.analises_credito.limite_aprovado))} aprovados
                                {v.analises_credito.estagio === 'aprovada_parcial' ? ' (parcial)' : ''}
                              </TiraDoCard>
                            ) : coluna === 'em_analise_credito' && v.situacao === 'em_andamento' ? (
                              <TiraDoCard tom="neutro">
                                {v.analises_credito
                                  ? `Crédito: ${ESTAGIO_ANALISE_LABELS[v.analises_credito.estagio as EstagioAnalise] ?? v.analises_credito.estagio}.`
                                  : 'Aguardando a seguradora. O card anda sozinho quando ela decidir.'}
                              </TiraDoCard>
                            ) : v.situacao === 'ganho' && !v.primeira_operacao_em ? (
                              <TiraDoCard tom="neutro">
                                Ganho, sem operar ainda — sai do funil na primeira antecipação.
                              </TiraDoCard>
                            ) : undefined
                          }
                        />
                      ))}
                      {itens.length === 0 && <ColunaVazia>Nenhum negócio</ColunaVazia>}
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
      {aberto && (() => {
        // Negado pela seguradora: trava o avanço e deixa só o caminho de perder.
        const creditoNegado = aberto.analises_credito?.estagio === 'negada'
        return (
        <ModalDoCard
          aberto
          onOpenChange={(o) => !o && setAberto(null)}
          titulo={aberto.empresas?.razao_social ?? 'Negócio'}
          subtitulo={ESTAGIO_VENDA_LABELS[aberto.estagio as EstagioVenda] ?? aberto.estagio}
          cabecalho={
            <div className="flex flex-wrap items-center gap-2">
              {aberto.empresas?.uf ? <Badge variant="outline">{aberto.empresas.uf}</Badge> : null}
              <Badge variant="outline">{ehInbound(aberto) ? 'Inbound' : 'Outbound'}</Badge>
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
              etapas={ESTAGIOS_VENDA.map((e, i) => ({
                id: e,
                label: ESTAGIO_VENDA_LABELS[e],
                bloqueada:
                  // Perdido não anda: o estágio registra até onde o negócio chegou antes
                  // de morrer, e movê-lo apagaria essa informação. Reabrir primeiro.
                  aberto.situacao === 'perdido'
                    ? 'negócio perdido — reabra para mover'
                    : // Crédito negado trava o que vem DEPOIS da análise. O que vem antes
                      // segue livre: voltar para juntar documento e pedir de novo é um
                      // caminho legítimo, e é o único que sobra além de marcar perdido.
                      creditoNegado && i > ESTAGIOS_VENDA.indexOf('em_analise_credito')
                      ? 'crédito negado — só resta marcar como perdido'
                      : undefined,
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
            {
              id: 'credito',
              label: 'Crédito e documentos',
              conteudo: (
                <AbaCredito
                  vendaId={aberto.id}
                  analise={aberto.analises_credito}
                  temCredito={temCredito}
                  onMudou={() => void qc.invalidateQueries({ queryKey: comercialKeys.vendas(vendedorId) })}
                />
              ),
            },
            /*
             * A reunião que originou este card — e as que vierem depois dela.
             *
             * A condição é ter vindo do funil de reuniões (`sdr_leads`), e não
             * estar no estágio de reunião: um card que já avançou para proposta
             * continua tendo uma reunião marcada, e é meia hora antes dela que
             * alguém procura o link. Um negócio criado à mão nunca teve reunião
             * agendada por aqui, e para ele a aba não aparece em vez de aparecer
             * vazia para sempre.
             */
            ...(aberto.sdr_leads
              ? [
                  {
                    id: 'reuniao',
                    label: 'Reunião',
                    conteudo: (
                      <AbaReuniao vendaId={aberto.id} empresaId={aberto.empresas?.id ?? null} />
                    ),
                  },
                ]
              : []),
            /*
              Notas vêm ANTES de Empresa: é o que a pessoa escreveu, e quem abre um card
              que já conhece vem ler a última coisa que ficou combinada — não a ficha
              cadastral, que não muda.
            */
            { id: 'notas', label: 'Notas', conteudo: <AbaNotas funil="vendedor" cardId={aberto.id} /> },
            { id: 'empresa', label: 'Empresa', conteudo: <AbaEmpresa empresaId={aberto.empresas?.id ?? null} /> },
            /*
             * O que a PESSOA escreveu. A aba Empresa mostra o que o sistema descobriu
             * sozinho — CNAE, porte, score; esta mostra o que o lead se deu ao trabalho de
             * digitar, que é a única parte com a intenção dele dentro.
             */
            {
              id: 'formulario',
              label: 'Formulário',
              conteudo: <AbaFormulario empresaId={aberto.empresas?.id ?? null} />,
            },
            {
              id: 'mensagens',
              label: 'Mensagens',
              conteudo: (
                <AbaMensagens
                  empresaId={aberto.empresas?.id ?? null}
                  funil="vendas"
                  funilCardId={aberto.id}
                />
              ),
            },
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
                {/* Crédito negado tira "Ganhei" da mesa: sem limite não há operação, e
                    deixar o botão aceso convidaria a marcar ganho um negócio que a
                    seguradora acabou de inviabilizar. */}
                {!creditoNegado && (
                  <Button
                    size="sm"
                    disabled={agindo}
                    onClick={() => void encerrar(aberto, 'ganho')}
                    className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    <ThumbsUp className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Ganhei
                  </Button>
                )}
              </>
            ) : null
          }
        />
        )
      })()}

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
