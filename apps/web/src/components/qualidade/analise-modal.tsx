'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, ExternalLink, Phone } from 'lucide-react'
import {
  ESCOPO_ANALISE_LABELS,
  estadoDaLigacao,
  type AnaliseDetalhe as AnaliseDetalheDados,
  type ParticipanteDetectado,
} from '@jobsiteos/core'
import { LinkEmAba } from '@/components/shell/link-em-aba'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { AnaliseDetalhe } from './analise-detalhe'
import { buscarAnalise, buscarEhGestor, qualidadeKeys } from './queries'
import { TranscricaoComBusca } from './transcricao'

/**
 * O MODAL DE INTERAÇÃO (05C §6): a análise de uma reunião, ligação ou janela de conversa,
 * com a própria interação ao lado.
 *
 * É a porta de todo lugar que mostra uma nota — o selo da empresa, o da conversa, a aba
 * Feedback, a notificação que chega por `?analise=`. A interação vai junto porque a
 * análise sozinha é uma opinião sobre um texto que a pessoa não está vendo: para
 * concordar (ou contestar) ela precisa do que foi dito.
 */
export function AnaliseModal({
  analiseId,
  aberto,
  onOpenChange,
}: {
  analiseId: string
  aberto: boolean
  onOpenChange: (aberto: boolean) => void
}) {
  const consulta = useQuery({
    queryKey: qualidadeKeys.analise(analiseId),
    queryFn: () => buscarAnalise(analiseId),
    enabled: aberto,
  })
  const gestor = useQuery({ queryKey: qualidadeKeys.ehGestor(), queryFn: buscarEhGestor, staleTime: 5 * 60_000 })

  const d = consulta.data

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {d ? `Análise da ${ESCOPO_ANALISE_LABELS[d.analise.escopo].toLowerCase()}` : 'Análise'}
          </DialogTitle>
          <DialogDescription>
            Análise gerada por IA. Use o botão Contestar quando discordar de um item — é assim que o
            sistema aprende.
          </DialogDescription>
        </DialogHeader>

        {consulta.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : consulta.isError ? (
          <p className="text-sm text-destructive">
            Não foi possível carregar a análise: {(consulta.error as Error).message}
          </p>
        ) : !d ? (
          /* A RPC devolve nulo tanto para "não existe" quanto para "não é sua para ver" —
             e a análise em sombra, para quem não é gestor. Não há por que distinguir. */
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Esta análise não está disponível para você.
          </p>
        ) : (
          <>
            <Cabecalho d={d} />
            <Tabs defaultValue="analise" className="space-y-3">
              <TabsList>
                <TabsTrigger value="analise">Análise item a item</TabsTrigger>
                {d.interacao ? <TabsTrigger value="interacao">{rotuloInteracao(d)}</TabsTrigger> : null}
              </TabsList>
              <TabsContent value="analise" className="mt-0">
                <AnaliseDetalhe detalhe={d} ehGestor={gestor.data === true} />
              </TabsContent>
              {d.interacao ? (
                <TabsContent value="interacao" className="mt-0">
                  <Interacao d={d} />
                </TabsContent>
              ) : null}
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function rotuloInteracao(d: AnaliseDetalheDados): string {
  if (d.analise.escopo === 'reuniao') return 'A reunião'
  if (d.analise.escopo === 'ligacao') return 'A ligação'
  return 'A conversa'
}

const dataHora = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

export function duracaoLegivel(s: number | null | undefined): string | null {
  if (s === null || s === undefined || !Number.isFinite(s)) return null
  const min = Math.round(s / 60)
  if (min < 1) return `${Math.round(s)} s`
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}

function Cabecalho({ d }: { d: AnaliseDetalheDados }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {d.empresa ? (
        <LinkEmAba
          href={`/empresas/${d.empresa.id}`}
          tituloDaAba={d.empresa.nome ?? 'Empresa'}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {d.empresa.nome ?? 'Empresa'}
        </LinkEmAba>
      ) : (
        <span>Empresa não vinculada</span>
      )}
      {d.contato ? (
        <span>
          {d.contato.nome ?? 'Contato'}
          {d.contato.cargo ? ` (${d.contato.cargo})` : ''}
        </span>
      ) : null}
      {d.vendedor ? (
        <span className="inline-flex items-center gap-1">
          Conduzida por {d.vendedor.nome}
          {d.vendedor.is_ia ? (
            <Badge variant="outline" className="gap-0.5 px-1.5 py-0 text-[10px]">
              <Bot className="h-2.5 w-2.5" aria-hidden />
              IA
            </Badge>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}

function Interacao({ d }: { d: AnaliseDetalheDados }) {
  const i = d.interacao
  if (!i) return null
  if (d.analise.escopo === 'reuniao') return <InteracaoReuniao i={i} />
  if (d.analise.escopo === 'ligacao') return <InteracaoLigacao i={i} />
  return <InteracaoJanela i={i} />
}

type DadosInteracao = NonNullable<AnaliseDetalheDados['interacao']>

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  )
}

function LinkExterno({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button size="sm" variant="outline" className="h-7" asChild>
      <a href={href} target="_blank" rel="noreferrer">
        <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
        {children}
      </a>
    </Button>
  )
}

export function Participantes({ lista }: { lista: ParticipanteDetectado[] | null | undefined }) {
  if (!lista || lista.length === 0) return null
  const falaram = lista.filter((p) => p.falou)
  const soConvidados = lista.filter((p) => !p.falou)
  const nome = (p: ParticipanteDetectado) => p.nome || p.email || 'Sem nome'
  return (
    <div className="space-y-1 text-xs">
      <p>
        <span className="font-medium">Falaram: </span>
        {falaram.length > 0 ? falaram.map(nome).join(', ') : <span className="text-muted-foreground">ninguém identificado</span>}
      </p>
      {soConvidados.length > 0 ? (
        <p className="text-muted-foreground">
          <span className="font-medium">Só convidados (não falaram): </span>
          {soConvidados.map(nome).join(', ')}
        </p>
      ) : null}
    </div>
  )
}

export function ProximosPassos({ passos }: { passos: string[] | null | undefined }) {
  if (!passos || passos.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">Próximos passos detectados</p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs">
        {passos.map((p, k) => (
          <li key={k}>{p}</li>
        ))}
      </ul>
    </div>
  )
}

function InteracaoReuniao({ i }: { i: DadosInteracao }) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Campo rotulo="Reunião">{i.titulo ?? '—'}</Campo>
        <Campo rotulo="Quando">{dataHora(i.inicio_em)}</Campo>
        <Campo rotulo="Duração gravada">{duracaoLegivel(i.duracao_s) ?? '—'}</Campo>
      </dl>
      {i.url_fireflies ? <LinkExterno href={i.url_fireflies}>Abrir no Fireflies</LinkExterno> : null}
      <Participantes lista={i.participantes} />
      {i.resumo ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">Resumo</p>
          <p className="whitespace-pre-wrap text-xs">{i.resumo}</p>
        </div>
      ) : null}
      <ProximosPassos passos={i.proximos_passos} />
      {i.texto ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">Transcrição</p>
          <TranscricaoComBusca texto={i.texto} alturaClasse="max-h-[40vh]" />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          A transcrição não está mais disponível (política de retenção); a análise continua valendo.
        </p>
      )}
    </div>
  )
}

function InteracaoLigacao({ i }: { i: DadosInteracao }) {
  // O formato dos turnos é do fornecedor de voz; o core já sabe ler as variantes.
  const linhas = React.useMemo(
    () =>
      estadoDaLigacao(i.turnos)
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const k = l.indexOf(': ')
          return k > 0 ? { falante: l.slice(0, k), texto: l.slice(k + 2) } : { falante: null, texto: l }
        }),
    [i.turnos],
  )
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Campo rotulo="Telefone">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Phone className="h-3 w-3 text-muted-foreground" aria-hidden />
            {i.telefone ?? '—'}
          </span>
        </Campo>
        <Campo rotulo="Quando">{dataHora(i.iniciada_em)}</Campo>
        <Campo rotulo="Duração">{duracaoLegivel(i.duracao_s) ?? '—'}</Campo>
        <Campo rotulo="Desfecho">{i.outcome ?? '—'}</Campo>
      </dl>
      {i.gravacao ? <LinkExterno href={i.gravacao}>Ouvir a gravação</LinkExterno> : null}
      {i.resumo ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">Resumo</p>
          <p className="whitespace-pre-wrap text-xs">{i.resumo}</p>
        </div>
      ) : null}
      {linhas.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">Transcrição</p>
          <TranscricaoComBusca linhas={linhas} alturaClasse="max-h-[40vh]" />
        </div>
      ) : null}
    </div>
  )
}

function InteracaoJanela({ i }: { i: DadosInteracao }) {
  const mensagens = i.mensagens ?? []
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Campo rotulo="Canal">{i.canal === 'email' ? 'E-mail' : i.canal === 'whatsapp' ? 'WhatsApp' : i.canal ?? '—'}</Campo>
        <Campo rotulo="Contato">{i.identificador ?? '—'}</Campo>
        <Campo rotulo="Janela">
          {i.inicio ? `${dataHora(i.inicio)} → ` : 'até '}
          {dataHora(i.fim)}
        </Campo>
        <Campo rotulo="Mensagens">{i.mensagens_qtd ?? mensagens.length}</Campo>
      </dl>
      {i.conversa_id ? (
        <Button size="sm" variant="outline" className="h-7" asChild>
          <LinkEmAba href={`/comunicacao/${i.conversa_id}`} tituloDaAba="Conversa">
            Abrir a conversa
          </LinkEmAba>
        </Button>
      ) : null}
      {mensagens.length > 0 ? (
        <ul className="max-h-[40vh] space-y-1.5 overflow-y-auto rounded-md border border-border bg-muted/20 p-2.5">
          {mensagens.map((m) => {
            const entrada = m.direcao === 'entrada'
            return (
              <li key={m.id} className={cn('flex', entrada ? 'justify-start' : 'justify-end')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-md border px-2.5 py-1.5 text-xs',
                    entrada ? 'bg-card' : 'bg-primary/5',
                  )}
                >
                  <p className="mb-0.5 text-[10px] text-muted-foreground">
                    {entrada ? 'Cliente' : m.por_ia ? 'Equipe (IA)' : 'Equipe'} · {dataHora(m.criado_em)}
                  </p>
                  {m.assunto ? <p className="font-medium">{m.assunto}</p> : null}
                  <p className="whitespace-pre-wrap break-words">
                    {m.corpo ?? <span className="italic text-muted-foreground">(sem texto)</span>}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">As mensagens desta janela não estão disponíveis.</p>
      )}
    </div>
  )
}
