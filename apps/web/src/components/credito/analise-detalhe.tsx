'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ExternalLink,
  FileText,
  Gauge,
  Hash,
  MapPin,
  PlayCircle,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react'
import {
  ESTAGIOS_MANUAIS,
  ESTAGIO_ANALISE_LABELS,
  FAIXA_SCORE_LABELS,
  KNOCKOUT_LABELS,
  ehEstagioDecidido,
  formatCnpj,
  type DecisaoFinal,
  type EstagioAnalise,
  type FaixaScore,
  type Knockout,
  type OpcoesProtesto,
  type Quadrante,
  type StatusAnalisePropria,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FichaGrade, FichaIdentidade, FichaTopo } from '@/components/ficha/ficha'
import { VoltarContextual } from '@/components/shell/voltar-contextual'
import { enviarAnalisesAction, moverAnaliseAction } from '@/actions/credito'
import { rodarAnalisePropriaAction } from '@/actions/credito-analise'
import { DialogoRodarAnalise } from './analise-propria/dialogo-rodar'
import { creditoKeys } from './queries'
import { Confronto } from './analise-propria/confronto'
import { DetalheCarregandoFicha } from './analise-propria/carregando'
import { Documentos } from './analise-propria/documentos'
import { Parecer } from './analise-propria/parecer'
import { RevisaoExtracao } from './analise-propria/revisao-extracao'
import { Cenarios, Indicadores, Lacunas, Tetos, brl } from './analise-propria/resultado'
import { StatusAnalise } from './analise-propria/status-analise'
import { analisePropriaKeys, buscarPainelSacado } from './analise-propria/queries'

/**
 * A ficha de uma análise de crédito.
 *
 * ─── POR QUE ELA É UMA FICHA, COMO A DA EMPRESA ─────────────────────────────
 * Antes eram duas telas empilhadas: os dados da seguradora numa grade de cards, e a
 * análise proprietária logo abaixo, com abas próprias no meio da rolagem. Duas caixas de
 * abas na mesma página é o tipo de coisa que ninguém decide fazer — acontece quando um
 * bloco novo chega e é pendurado no fim do que já existia.
 *
 * Agora é a mesma forma da Company 360 (`components/ficha/ficha.tsx`): voltar, topo,
 * status, ABAS NO ALTO, e uma grade com a identidade fixa à esquerda. A identidade não é
 * uma aba — é de quem se está falando, e sumir com ela ao trocar de aba é o caminho mais
 * curto para alguém registrar uma decisão de crédito na empresa errada.
 *
 * ─── UMA CONSULTA SÓ ────────────────────────────────────────────────────────
 * `analise_propria_painel` já devolve esteira, empresa, score, protestos, NF-e observada,
 * documentos e a análise proprietária numa chamada de ~13ms. A tela lia a esteira por
 * fora, o painel por dentro, e as duas podiam discordar por alguns segundos depois de uma
 * mutação — tempo suficiente para o cabeçalho dizer "solicitada" enquanto o corpo já
 * mostrava a decisão.
 */

const moeda = (v: number | null | undefined): string => brl(v)

const formatData = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('pt-BR') : '—'

/**
 * As ações da análise, todas no mesmo lugar: enviar à seguradora, rodar a nossa análise
 * e mover de estágio.
 *
 * ─── POR QUE O ENVIO MORA AQUI, E NÃO NA ESTEIRA ────────────────────────────
 * O envio resolve o cadastro do buyer na Atradius e PODE SER COBRADO. Na tela da esteira
 * ele era um botão de lote alimentado por checkboxes nos cards — uma ação cara disparada
 * a partir de uma lista, onde tudo que se vê de cada análise é o nome e um valor.
 *
 * Aqui ele fica ao lado do que justifica a decisão: os documentos anexados, o score, os
 * protestos, a nossa recomendação. Enviar sem cobertura documental é jogar dinheiro fora
 * — e o único lugar em que dá para saber isso antes de clicar é este.
 */
function Acoes({
  analiseId,
  nome,
  estagio,
  statusPropria,
  jaTemPropria,
  empresaId,
  temGrupo,
  protestoConsultadoEm,
  recenciaDias,
  anosAtrasPadrao,
  onMudou,
}: {
  analiseId: string
  nome: string
  estagio: EstagioAnalise
  statusPropria: StatusAnalisePropria | null
  jaTemPropria: boolean
  empresaId: string | null
  temGrupo: boolean
  protestoConsultadoEm: string | null
  recenciaDias: number
  anosAtrasPadrao: number
  onMudou: () => void
}) {
  const [movendo, setMovendo] = React.useState(false)
  const [rodando, setRodando] = React.useState(false)
  const [confirmandoRodar, setConfirmandoRodar] = React.useState(false)
  const [confirmandoEnvio, setConfirmandoEnvio] = React.useState(false)
  const [enviando, setEnviando] = React.useState(false)

  const decidida = ehEstagioDecidido(estagio)
  // Só "solicitada" vai à seguradora — é o que o worker aceita, e oferecer o botão nos
  // outros estágios seria desenhar um clique que não faz nada.
  const podeEnviar = estagio === 'solicitada'

  async function enviar() {
    setEnviando(true)
    const r = await enviarAnalisesAction([analiseId])
    setEnviando(false)
    setConfirmandoEnvio(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (!r.data.enfileirado) {
      toast.error(r.data.aviso ?? 'O worker não aceitou o envio.')
      return
    }
    toast.success('Envio disparado. A decisão chega pelo acompanhamento automático.')
    onMudou()
  }
  // Enquanto o worker trabalha ou a revisão espera, rodar de novo só gastaria os mesmos
  // tokens sobre os mesmos PDFs — e o RPC recusaria de qualquer forma.
  const podeRodar = statusPropria !== 'processando' && statusPropria !== 'aguardando_revisao'

  async function mover(novo: string) {
    setMovendo(true)
    const r = await moverAnaliseAction({ id: analiseId, estagio: novo })
    setMovendo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Análise movida.')
    onMudou()
  }

  async function rodar(protestos: OpcoesProtesto) {
    setRodando(true)
    const r = await rodarAnalisePropriaAction({
      analise_credito_id: analiseId,
      tipo: jaTemPropria ? 'reanalise' : 'inicial',
      gatilho: 'manual',
      protestos,
    })
    setRodando(false)
    setConfirmandoRodar(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      r.data.worker_acordado
        ? 'Análise iniciada. A extração roda em segundo plano e para para a sua revisão.'
        : 'Análise registrada, mas o worker não respondeu. A rotina diária a retoma.',
    )
    onMudou()
  }

  return (
    <>
      {podeEnviar && (
        <Button size="sm" variant="default" onClick={() => setConfirmandoEnvio(true)}>
          <Send className="mr-1.5 size-3.5" aria-hidden />
          Enviar à seguradora
        </Button>
      )}
      {podeRodar && (
        <Button
          size="sm"
          variant={podeEnviar ? 'outline' : 'default'}
          onClick={() => setConfirmandoRodar(true)}
          disabled={rodando}
        >
          {jaTemPropria ? (
            <RefreshCw className="mr-1.5 size-3.5" aria-hidden />
          ) : (
            <PlayCircle className="mr-1.5 size-3.5" aria-hidden />
          )}
          {rodando ? 'Iniciando…' : jaTemPropria ? 'Rodar de novo' : 'Rodar nossa análise'}
        </Button>
      )}
      {!decidida && (
        <Select value="" onValueChange={(v) => void mover(v)} disabled={movendo}>
          <SelectTrigger className="h-9 w-44" aria-label="Mover análise">
            <SelectValue placeholder="Mover para…" />
          </SelectTrigger>
          <SelectContent>
            {ESTAGIOS_MANUAIS.filter((e) => e !== estagio).map((e) => (
              <SelectItem key={e} value={e}>
                {ESTAGIO_ANALISE_LABELS[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <DialogoRodarAnalise
        aberto={confirmandoRodar}
        onOpenChange={setConfirmandoRodar}
        empresaId={empresaId}
        temGrupo={temGrupo}
        protestoConsultadoEm={protestoConsultadoEm}
        recenciaDias={recenciaDias}
        anosAtrasPadrao={anosAtrasPadrao}
        jaTemPropria={jaTemPropria}
        rodando={rodando}
        onConfirmar={(protestos) => void rodar(protestos)}
      />

      {/*
       * Diálogo, e não clique direto: `resolverBuyer` pode ser cobrado, uma vez por CNPJ
       * sem cadastro na Atradius. Mesma cerimônia dos protestos, pelo mesmo motivo.
       */}
      <Dialog open={confirmandoEnvio} onOpenChange={setConfirmandoEnvio}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar à seguradora</DialogTitle>
            <DialogDescription>
              O envio resolve o cadastro do buyer na Atradius, e{' '}
              <strong>essa consulta pode ser cobrada</strong> — uma vez por CNPJ que ainda não
              tem cadastro. Depois disso o pedido de cobertura é submetido e a decisão chega
              pelo acompanhamento automático.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md border p-3 text-sm">{nome}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmandoEnvio(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void enviar()} disabled={enviando}>
              {enviando ? 'Enviando…' : 'Enviar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function AnaliseDetalhe({ id }: { id: string }) {
  const qc = useQueryClient()

  const { data, isPending, isError, error } = useQuery({
    queryKey: analisePropriaKeys.painel(id),
    queryFn: () => buscarPainelSacado(id),
    /**
     * Dois motivos para voltar sozinha, e os dois têm relógio de outra pessoa: a
     * seguradora responde pelo poll do worker, e a extração roda por minutos. Sem
     * refetch a tela ficaria dizendo "em análise" para sempre, e alguém recarregaria a
     * página para descobrir que já tinha acabado.
     */
    refetchInterval: (q) => {
      const p = q.state.data
      if (p?.propria?.status === 'processando') return 10_000
      if (['enviada_seguradora', 'em_analise'].includes(p?.esteira?.estagio ?? '')) return 30_000
      return false
    },
  })

  const [aba, setAba] = React.useState('analise')
  const status = (data?.propria?.status ?? null) as StatusAnalisePropria | null

  // A aba de abertura segue o ESTADO: extração esperando revisão abre em "Revisão".
  // Só reage à troca de status — mexer a cada refetch tiraria a aba de baixo de quem
  // estava lendo o parecer.
  React.useEffect(() => {
    if (status === 'aguardando_revisao') setAba('revisao')
  }, [status])

  const invalidar = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: analisePropriaKeys.painel(id) })
    void qc.invalidateQueries({ queryKey: creditoKeys.esteira() })
  }, [qc, id])

  if (isPending) return <DetalheCarregandoFicha />

  if (isError || !data?.encontrado || !data.esteira) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {isError && error instanceof Error ? error.message : 'Análise não encontrada.'}
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/credito">Voltar para a esteira</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const esteira = data.esteira
  const propria = data.propria
  const empresa = data.empresa
  const estagio = esteira.estagio as EstagioAnalise
  const nome = empresa?.razao_social ?? empresa?.nome_fantasia ?? formatCnpj(esteira.cnpj)
  const local = [empresa?.municipio, empresa?.uf].filter(Boolean).join(' / ')
  const concluida = status === 'concluida'

  return (
    <div className="space-y-4">
      <VoltarContextual padrao={{ href: '/credito', label: 'Esteira' }} />

      {/*
       * O título é a CONSTRUTORA, não "Análise de crédito".
       *
       * Quem chega aqui já sabe que está numa análise — veio da esteira, ou de um link
       * que dizia isso. O que ela precisa confirmar em meio segundo é DE QUEM é esta, e
       * um título igual em todas as análises não confirma nada. O que a tela é vira a
       * linha de baixo, junto do CNPJ, que é onde ela basta.
       */}
      <FichaTopo titulo={nome} descricao={`Análise de crédito · ${formatCnpj(esteira.cnpj)}`} />

      {/*
       * A banda de status ANTES das abas e fora da grade: ela vale para a tela inteira,
       * não para uma aba. E fora da coluna estreita porque o número que ela carrega é o
       * mais importante da página — espremê-lo em um terço da largura seria repetir, com
       * outra geometria, o problema de tê-lo num badge de 11px.
       */}
      <StatusAnalise
        estagio={estagio}
        statusPropria={status}
        etapa={propria?.etapa ?? null}
        erro={propria?.erro ?? null}
        recomendacao={propria?.recomendacao ?? null}
        limiteRecomendado={propria?.limite_recomendado ?? null}
        limiteAprovado={esteira.limite_aprovado}
        limiteOperacional={esteira.limite_operacional}
        decisaoFinal={propria?.decisao_final ?? null}
        acao={
          <Acoes
            analiseId={id}
            nome={nome}
            estagio={estagio}
            statusPropria={status}
            jaTemPropria={propria !== null}
            empresaId={empresa?.id ?? null}
            temGrupo={(data.metricas?.grupo_spes_total ?? 0) > 0}
            protestoConsultadoEm={data.protestos?.consultado_em ?? null}
            recenciaDias={data.parametros_ativos?.protestos?.recencia_dias ?? 90}
            anosAtrasPadrao={data.parametros_ativos?.protestos?.spes_anos_atras_padrao ?? 5}
            onMudou={invalidar}
          />
        }
      />

      <Tabs value={aba} onValueChange={setAba} className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="analise">Nossa análise</TabsTrigger>
          {status === 'aguardando_revisao' && <TabsTrigger value="revisao">Revisão</TabsTrigger>}
          <TabsTrigger value="parecer">Parecer</TabsTrigger>
          <TabsTrigger value="seguradora">Seguradora e decisão</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="contexto">Contexto</TabsTrigger>
        </TabsList>

        <FichaGrade
          identidade={
            <FichaIdentidade
              nome={nome}
              papel={empresa?.nome_fantasia && empresa.razao_social ? empresa.nome_fantasia : null}
              /*
               * O atalho para a ficha da empresa fica sob o NOME, e não no rodapé: é de
               * lá que o olho parte, e é a pergunta natural de quem acabou de ler a razão
               * social. Mesmo lugar do "ver quadro societário" na Company 360.
               */
              abaixoDoNome={
                empresa ? (
                  <Link
                    href={`/empresas/${empresa.id}`}
                    className="mx-auto flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    <Building2 className="size-3" aria-hidden />
                    Abrir a Company 360
                    <ExternalLink className="size-3" aria-hidden />
                  </Link>
                ) : null
              }
              tags={
                <>
                  <Badge variant="outline">{ESTAGIO_ANALISE_LABELS[estagio]}</Badge>
                  {esteira.origem === 'atradius_backfill' ? (
                    <Badge
                      variant="secondary"
                      title="Veio do backfill da apólice: já existia na seguradora e não foi pedida por aqui."
                    >
                      da apólice
                    </Badge>
                  ) : null}
                  {data.opera_na_plataforma ? <Badge variant="secondary">opera</Badge> : null}
                </>
              }
              /*
               * A tira de números da identidade é a do SACADO, não a da análise: os
               * limites já estão grandes na banda de status, e repeti-los aqui pequenos
               * ensinaria a ler o mesmo número em dois lugares com dois pesos.
               */
              resumo={[
                { label: 'Score', valor: data.score?.score ?? '—' },
                {
                  label: 'Faturamento',
                  valor: empresa?.faturamento_anual ? brl(empresa.faturamento_anual) : '—',
                },
                { label: 'Obras', valor: data.metricas?.obras_ativas ?? '—' },
              ]}
              linhas={[
                {
                  icone: Hash,
                  label: 'CNPJ',
                  valor: <span className="font-mono tabular-nums">{formatCnpj(esteira.cnpj)}</span>,
                },
                { icone: MapPin, label: 'Localização', valor: local || '—' },
                {
                  icone: Gauge,
                  label: 'Faixa de score',
                  valor: data.score
                    ? (FAIXA_SCORE_LABELS[data.score.faixa as FaixaScore] ?? data.score.faixa)
                    : 'nunca pontuada',
                },
                {
                  icone: ShieldCheck,
                  label: 'Protestos',
                  valor: data.protestos
                    ? data.protestos.tem_protesto
                      ? `${data.protestos.qtd_protestos} · ${brl(data.protestos.valor_total)}`
                      : 'sem protesto'
                    : 'nunca consultado',
                },
                {
                  icone: FileText,
                  label: 'Documentos',
                  valor: `${data.docs.length} anexado(s)`,
                },
                {
                  icone: CalendarClock,
                  label: 'Validade',
                  valor: esteira.expira_em ? formatData(esteira.expira_em) : '—',
                },
              ]}
              rodape={
                empresa
                  ? `Solicitada em ${formatData(esteira.criada_em)} · Atualizada em ${formatData(esteira.atualizada_em)}`
                  : 'Esta análise não está ligada a uma empresa cadastrada.'
              }
            />
          }
          conteudo={
            <>
              {/* ── Nossa análise ─────────────────────────────────────────── */}
              <TabsContent value="analise" className="mt-0 space-y-4">
                {!propria || !concluida ? (
                  <Card>
                    <CardContent className="py-12 text-center text-sm text-muted-foreground">
                      {status === 'processando'
                        ? 'A extração está rodando. Isto leva alguns minutos — a tela se atualiza sozinha.'
                        : status === 'aguardando_revisao'
                          ? 'Nada foi calculado ainda: os campos críticos esperam a sua confirmação na aba Revisão.'
                          : status === 'falhou'
                            ? `Falhou na etapa ${propria?.etapa ?? 'desconhecida'}: ${propria?.erro ?? ''}`
                            : 'Esta esteira ainda não tem análise proprietária. O botão está na banda de status, acima.'}
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <Cenarios
                      cenarios={propria.cenarios ?? []}
                      recomendacao={propria.recomendacao}
                      limite={propria.limite_recomendado}
                      motivos={propria.motivos_nao_operar ?? []}
                    />
                    <Tetos tetos={propria.tetos ?? []} />
                    <Indicadores indicadores={propria.indicadores ?? []} />
                    <Lacunas lacunas={propria.lacunas_calculo ?? []} />
                  </>
                )}
              </TabsContent>

              {/* ── Revisão ───────────────────────────────────────────────── */}
              {status === 'aguardando_revisao' && propria && (
                <TabsContent value="revisao" className="mt-0">
                  <RevisaoExtracao
                    analiseId={propria.id}
                    analiseCreditoId={id}
                    dados={propria.dados_extraidos}
                    docs={data.docs}
                  />
                </TabsContent>
              )}

              {/* ── Parecer ───────────────────────────────────────────────── */}
              <TabsContent value="parecer" className="mt-0">
                {propria ? (
                  <Parecer
                    analiseId={propria.id}
                    analiseCreditoId={id}
                    original={propria.parecer_markdown}
                    editado={propria.parecer_editado}
                    modelo={propria.parecer_modelo}
                    tokens={propria.parecer_tokens}
                    editadoEm={propria.parecer_editado_em}
                  />
                ) : (
                  <Card>
                    <CardContent className="py-12 text-center text-sm text-muted-foreground">
                      Sem análise, sem parecer.
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ── Seguradora e decisão ──────────────────────────────────── */}
              <TabsContent value="seguradora" className="mt-0 space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">O pedido na seguradora</CardTitle>
                    <CardDescription>
                      O que foi pedido e o que ela respondeu. Estes campos são escritos pelo
                      worker — a tela não define decisão de seguradora.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-muted-foreground">Limite solicitado</dt>
                        <dd className="text-sm tabular-nums">{moeda(esteira.limite_solicitado)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Limite aprovado</dt>
                        <dd className="text-sm font-medium tabular-nums">
                          {moeda(esteira.limite_aprovado)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Rating</dt>
                        <dd className="text-sm">{esteira.rating_seguradora ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Caso na seguradora</dt>
                        <dd className="font-mono text-xs">{esteira.atradius_case_id ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Validade</dt>
                        <dd className="text-sm">{formatData(esteira.expira_em)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Decidida em</dt>
                        <dd className="text-sm">{formatData(esteira.decidida_em)}</dd>
                      </div>
                      {esteira.motivo ? (
                        <div className="sm:col-span-2">
                          <dt className="text-xs text-muted-foreground">Motivo</dt>
                          <dd className="text-sm">{esteira.motivo}</dd>
                        </div>
                      ) : null}
                    </dl>

                    {esteira.origem === 'atradius_backfill' && (
                      <p className="mt-4 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                        Esta análise veio do <strong>backfill da apólice</strong>: ela já existia na
                        seguradora e não foi pedida por aqui. Fica marcada para o funil da esteira
                        não levar crédito por uma decisão que ele não tomou.
                      </p>
                    )}
                  </CardContent>
                </Card>

                {propria && concluida ? (
                  <Confronto
                    analiseId={propria.id}
                    analiseCreditoId={id}
                    quadrante={propria.quadrante as Quadrante | null}
                    nossaRecomendacao={propria.recomendacao}
                    nossoLimite={propria.limite_recomendado}
                    seguradoraStatus={propria.atradius_status}
                    seguradoraLimite={propria.atradius_limite}
                    decisaoAtual={propria.decisao_final as DecisaoFinal | null}
                    decisaoLimite={propria.decisao_limite}
                    decisaoMotivo={propria.decisao_motivo}
                    decidaEm={propria.decidida_em}
                  />
                ) : (
                  <Card>
                    <CardContent className="py-12 text-center text-sm text-muted-foreground">
                      O confronto exige as duas leituras. A nossa precisa estar concluída.
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ── Documentos ────────────────────────────────────────────── */}
              <TabsContent value="documentos" className="mt-0">
                <Documentos analiseId={id} docs={data.docs} />
              </TabsContent>

              {/* ── Contexto ──────────────────────────────────────────────── */}
              <TabsContent value="contexto" className="mt-0 space-y-4">
                <div className="grid items-start gap-4 xl:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Scorecard</CardTitle>
                      <CardDescription>
                        A chance de a SEGURADORA conceder (04d) — diferente da nossa análise, que
                        lê o balanço. Ele também vira um dos cinco tetos.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {data.score ? (
                        <dl className="space-y-1.5">
                          <Linha rotulo="Score" valor={data.score.score ?? 'não calculado'} />
                          <Linha
                            rotulo="Faixa"
                            valor={
                              FAIXA_SCORE_LABELS[data.score.faixa as FaixaScore] ?? data.score.faixa
                            }
                          />
                          <Linha
                            rotulo="Completude"
                            valor={`${Math.round(Number(data.score.completude) * 100)}%`}
                          />
                          {data.score.knockout ? (
                            <Linha
                              rotulo="Knockout"
                              valor={
                                <Badge variant="destructive">
                                  {KNOCKOUT_LABELS[data.score.knockout as Knockout] ??
                                    data.score.knockout}
                                </Badge>
                              }
                            />
                          ) : null}
                        </dl>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Esta empresa ainda não foi pontuada.
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Comportamento observado</CardTitle>
                      <CardDescription>
                        {data.opera_na_plataforma
                          ? 'A empresa opera: este é o teto mais confiável dos cinco, porque é comportamento e não declaração.'
                          : 'A empresa ainda não opera. O teto operacional fica fora do cálculo — não entra como zero.'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <dl className="space-y-1.5">
                        <Linha
                          rotulo="Opera na plataforma"
                          valor={data.opera_na_plataforma ? 'sim' : 'não'}
                        />
                        <Linha
                          rotulo={`NF-e (${data.nfe_observada.janela_meses} meses)`}
                          valor={`${data.nfe_observada.qtd} notas · ${brl(data.nfe_observada.total)}`}
                        />
                        <Linha rotulo="Média mensal" valor={brl(data.nfe_observada.media_mensal)} />
                      </dl>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Porte e estrutura</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <dl className="space-y-1.5">
                        <Linha
                          rotulo="Faturamento"
                          valor={
                            <>
                              {brl(empresa?.faturamento_anual ?? null)}
                              {empresa?.faturamento_confianca ? (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  (
                                  {empresa.faturamento_origem === 'declarado_cliente'
                                    ? 'declarado'
                                    : 'estimado'}
                                  , confiança {empresa.faturamento_confianca})
                                </span>
                              ) : null}
                            </>
                          }
                        />
                        <Linha rotulo="Patrimônio líquido" valor={brl(empresa?.patrimonio_liquido ?? null)} />
                        <Linha rotulo="Funcionários" valor={empresa?.funcionarios ?? '—'} />
                        <Linha rotulo="Filiais" valor={data.metricas?.qtd_filiais ?? '—'} />
                        <Linha rotulo="SPEs do grupo" valor={data.metricas?.grupo_spes_total ?? '—'} />
                        <Linha rotulo="Obras ativas" valor={data.metricas?.obras_ativas ?? '—'} />
                      </dl>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Risco e sinais</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <dl className="space-y-1.5">
                        <Linha
                          rotulo="Protestos"
                          valor={
                            data.protestos
                              ? data.protestos.tem_protesto
                                ? `${data.protestos.qtd_protestos} · ${brl(data.protestos.valor_total)}`
                                : 'sem protesto'
                              : 'nunca consultado'
                          }
                        />
                        <Linha
                          rotulo="Consultado em"
                          valor={formatData(data.protestos?.consultado_em)}
                        />
                        <Linha
                          rotulo="Certificado digital"
                          valor={
                            data.certificado?.expires_at
                              ? `vence em ${formatData(data.certificado.expires_at)}`
                              : 'não temos'
                          }
                        />
                        <Linha
                          rotulo="Limite potencial"
                          valor={brl(empresa?.limite_potencial ?? null)}
                        />
                        <Linha
                          rotulo="Valor esperado"
                          valor={`${brl(empresa?.valor_esperado_mensal ?? null)}/mês`}
                        />
                      </dl>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </>
          }
        />
      </Tabs>
    </div>
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 truncate text-right">{valor}</dd>
    </div>
  )
}
