'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, ExternalLink } from 'lucide-react'
import { ESTADOS_TERMINAIS, type EstadoMandato } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { data, dataHora, estadoLabel, motivoLabel, pct, reais, tipoLabel } from './format'
import { AcoesHumanasDoMandato } from './mandato-acoes-humanas'
import { ContatosTentados, HistoricoDoMandato } from './mandato-historico'
import { LinhaDoTempoDoMandato } from './mandato-linha-do-tempo'
import { PlanoAtual, VersoesDoPlano } from './mandato-plano'
import {
  agentesOpKeys,
  buscarMandato,
  nomeDaEmpresa,
  personaDoAgente,
  useAgentes,
  usePermissoesAgentes,
  type MandatoCompleto,
} from './queries-operacao'

/**
 * O modal do mandato — o mesmo no Ao vivo e no kanban (§11.1, §11.2).
 *
 * Nunca troca de página: quem clica numa ação do feed quer ver o mandato e VOLTAR ao feed
 * com um Esc. O estado aberto mora na URL (`?m=<id>`, ver `useParamDaUrl`) para o link
 * da notificação abrir exatamente aqui.
 *
 * ─── A ORDEM DA LEITURA ─────────────────────────────────────────────────────
 * Cabeçalho (o que é, de quem, onde está) → consumo contra os limites → o PLANO em
 * destaque → as abas de auditoria (ações, conversas, contatos). O plano vem antes da
 * linha do tempo porque responde a pergunta que se faz ao abrir: "o que ele está tentando
 * agora, e por quê?". A linha do tempo responde a segunda: "o que ele já fez?".
 *
 * A ALTURA é fixa com miolo rolável, como no `ModalDoCard` do Comercial: conteúdo variável
 * (cem ações, trinta mensagens) fazia a caixa crescer além da viewport.
 */
export function MandatoModal({ mandatoId, onFechar }: { mandatoId: string | null; onFechar: () => void }) {
  return (
    <Dialog open={Boolean(mandatoId)} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="flex h-[88vh] max-w-5xl flex-col gap-0 p-0">
        {mandatoId ? <ConteudoDoModal mandatoId={mandatoId} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ConteudoDoModal({ mandatoId }: { mandatoId: string }) {
  const mandato = useQuery({ queryKey: agentesOpKeys.mandato(mandatoId), queryFn: () => buscarMandato(mandatoId) })
  const permissoes = usePermissoesAgentes()
  const agentes = useAgentes()

  if (mandato.isPending) {
    return (
      <div className="space-y-4 p-5">
        <DialogTitle className="sr-only">Carregando mandato</DialogTitle>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const m = mandato.data
  if (!m) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <CircleAlert className="h-8 w-8 text-muted-foreground" aria-hidden />
        <DialogTitle className="text-base">Mandato não encontrado</DialogTitle>
        <DialogDescription>
          {mandato.error instanceof Error
            ? mandato.error.message
            : 'Ele pode não existir, ou ser de um agente que você não acompanha (o closer vê só os agentes de que é o closer designado).'}
        </DialogDescription>
      </div>
    )
  }

  const agente = (agentes.data ?? []).find((a) => a.id === m.agente_id)
  const nomeAgente = agente ? personaDoAgente(agente).nome : 'Agente'
  const terminado = ESTADOS_TERMINAIS.includes(m.estado as EstadoMandato)
  const motivo = motivoLabel(m.motivo_encerramento) ?? (m.estado === 'pausado' ? motivoPausa(m.pausado_motivo) : null)

  return (
    <>
      <DialogHeader className="space-y-2 border-b p-5 pb-3 text-left">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
              <span className="font-mono">{m.codigo ?? 'MDT'}</span>
              <Badge variant="secondary">{tipoLabel(m.tipo)}</Badge>
              <Badge variant={varianteDoEstado(m.estado)}>{estadoLabel(m.estado)}</Badge>
            </DialogTitle>
            <DialogDescription className="mt-1 text-foreground">{m.objetivo}</DialogDescription>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                Agente <span className="font-medium text-foreground">{nomeAgente}</span>
              </span>
              <Link
                href={`/empresas/${m.empresa_id}`}
                className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
              >
                {nomeDaEmpresa(m.empresas)}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
              <span>Prioridade {m.prioridade}</span>
              <span>Origem {ORIGEM_LABELS[m.origem] ?? m.origem}</span>
              <span>Criado {dataHora(m.criado_em)}</span>
            </p>
            {motivo ? (
              <p className="mt-1 text-xs">
                <span className="text-muted-foreground">{terminado ? 'Motivo: ' : 'Pausado: '}</span>
                {motivo}
                {m.resultado ? <span className="text-muted-foreground"> · {m.resultado}</span> : null}
              </p>
            ) : null}
            {m.ultimo_ciclo_erro ? (
              <p className="mt-1 text-xs text-destructive">Último ciclo falhou: {m.ultimo_ciclo_erro}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 pr-8">
            <AcoesHumanasDoMandato mandato={m} gestor={permissoes.data?.gestor === true} />
          </div>
        </div>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="space-y-5">
          <Consumo m={m} />

          <div className="grid gap-5 lg:grid-cols-5">
            <div className="space-y-3 lg:col-span-2">
              <PlanoAtual bruto={m.plano} versao={m.plano_versao} />
              <VersoesDoPlano mandatoId={m.id} versaoAtual={m.plano_versao} />
            </div>
            <div className="lg:col-span-3">
              <Tabs defaultValue="acoes">
                <TabsList>
                  <TabsTrigger value="acoes">Ações</TabsTrigger>
                  <TabsTrigger value="historico">Conversas e ligações</TabsTrigger>
                  <TabsTrigger value="contatos">Contatos tentados</TabsTrigger>
                </TabsList>
                <TabsContent value="acoes" className="mt-3">
                  <LinhaDoTempoDoMandato mandatoId={m.id} />
                </TabsContent>
                <TabsContent value="historico" className="mt-3">
                  <HistoricoDoMandato mandatoId={m.id} />
                </TabsContent>
                <TabsContent value="contatos" className="mt-3">
                  <ContatosTentados bruto={m.contatos_tentados} />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * Gasto contra orçamento, ações contra o máximo, e o prazo. São os três limites que
 * encerram um mandato sozinhos (§2.4) — quem olha tem de ver qual deles está perto.
 */
function Consumo({ m }: { m: MandatoCompleto }) {
  const diasRestantes = Math.ceil((new Date(m.expira_em).getTime() - Date.now()) / 86_400_000)
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Medidor
        rotulo="Orçamento"
        valor={`${reais(m.gasto_centavos)} de ${reais(m.orcamento_centavos)}`}
        pctUsado={pct(m.gasto_centavos, m.orcamento_centavos)}
      />
      <Medidor
        rotulo="Ações"
        valor={`${m.acoes_executadas} de ${m.max_acoes}`}
        pctUsado={pct(m.acoes_executadas, m.max_acoes)}
      />
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">Prazo</p>
        <p className="text-sm font-medium tabular-nums">Expira em {data(m.expira_em)}</p>
        <p className={cn('text-xs', diasRestantes <= 2 ? 'text-destructive' : 'text-muted-foreground')}>
          {m.encerrado_em
            ? `Terminou em ${dataHora(m.encerrado_em)}`
            : diasRestantes < 0
              ? 'Vencido'
              : diasRestantes === 0
                ? 'Vence hoje'
                : `Faltam ${diasRestantes} dia(s)`}
          {m.proxima_acao_em && !m.encerrado_em ? ` · próxima ação ${dataHora(m.proxima_acao_em)}` : ''}
        </p>
      </div>
    </div>
  )
}

export function Medidor({ rotulo, valor, pctUsado }: { rotulo: string; valor: string; pctUsado: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-sm font-medium tabular-nums">{valor}</p>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={cn('h-full rounded-full', pctUsado >= 95 ? 'bg-destructive' : pctUsado >= 80 ? 'bg-amber-500' : 'bg-primary')}
          style={{ width: `${pctUsado}%` }}
        />
      </div>
    </div>
  )
}

const ORIGEM_LABELS: Record<string, string> = {
  regra: 'regra automática',
  manual: 'delegado por uma pessoa',
  escalonamento: 'proposta de outro mandato',
}

const PAUSA_LABELS: Record<string, string> = {
  orcamento_esgotado: 'orçamento esgotado',
  disjuntor_aberto: 'o disjuntor do agente abriu',
  agente_pausado: 'o agente está pausado',
  manual: 'pausado por uma pessoa',
}

function motivoPausa(m: string | null): string | null {
  if (!m) return null
  return PAUSA_LABELS[m] ?? m
}

export function varianteDoEstado(e: string): 'success' | 'warning' | 'critical' | 'info' | 'neutral' {
  switch (e) {
    case 'em_andamento':
      return 'info'
    case 'aguardando_externo':
    case 'aberto':
      return 'neutral'
    case 'pausado':
      return 'warning'
    case 'concluido':
      return 'success'
    case 'escalado':
      return 'warning'
    case 'encerrado_sem_sucesso':
      return 'critical'
    default:
      return 'neutral'
  }
}
