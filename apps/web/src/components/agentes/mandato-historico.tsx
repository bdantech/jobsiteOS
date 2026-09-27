'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Bot, Phone } from 'lucide-react'
import type { Json } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { canalLabel } from '@/components/comunicacao/format'
import { cn } from '@/lib/utils'
import { dataHora, STATUS_LIGACAO_LABELS } from './format'
import { agentesOpKeys, buscarHistoricoDoMandato, lerContatosTentados, type ItemDoHistorico } from './queries-operacao'

/**
 * Todas as conversas e ligações do mandato num histórico só (§11.2), mais recente no
 * topo. Ver `buscarHistoricoDoMandato` para o porquê de juntar por relógio.
 */
export function HistoricoDoMandato({ mandatoId }: { mandatoId: string }) {
  const historico = useQuery({
    queryKey: agentesOpKeys.historico(mandatoId),
    queryFn: () => buscarHistoricoDoMandato(mandatoId),
  })

  if (historico.isPending) return <Skeleton className="h-48 w-full" />
  if (historico.isError) {
    return (
      <p className="text-sm text-destructive">
        {historico.error instanceof Error ? historico.error.message : 'Erro ao carregar o histórico.'}
      </p>
    )
  }
  const itens = historico.data ?? []
  if (itens.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Nenhuma conversa ou ligação ainda.</p>
        <p className="mt-1">
          As conversas entram aqui quando o agente escreve ou liga para alguém da empresa. Mensagens seguem o
          acesso do módulo Comunicação: sem ele, só as ligações aparecem.
        </p>
      </div>
    )
  }

  return (
    <ol className="space-y-2">
      {itens.map((i) => (i.tipo === 'mensagem' ? <Mensagem key={`m-${i.id}`} i={i} /> : <Ligacao key={`l-${i.id}`} i={i} />))}
    </ol>
  )
}

function Mensagem({ i }: { i: Extract<ItemDoHistorico, { tipo: 'mensagem' }> }) {
  const entrada = i.direcao === 'entrada'
  return (
    <li className={cn('rounded-md border p-2.5 text-sm', entrada ? 'bg-muted/40' : 'bg-background')}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {entrada ? (
          <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-600" aria-label="Recebida" />
        ) : (
          <ArrowUpRight className="h-3.5 w-3.5 text-sky-600" aria-label="Enviada" />
        )}
        <Badge variant="neutral">{canalLabel(i.canal)}</Badge>
        <span className="font-medium">{entrada ? (i.contato ?? 'Contato') : i.porIa ? 'Agente' : 'Pessoa da equipe'}</span>
        {!entrada && i.contato ? <span className="text-muted-foreground">para {i.contato}</span> : null}
        {i.porIa && !entrada ? <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-label="Escrita pela IA" /> : null}
        <span className="ml-auto tabular-nums text-muted-foreground">{dataHora(i.em)}</span>
      </div>
      {i.assunto ? <p className="mt-1 font-medium">{i.assunto}</p> : null}
      {i.texto ? <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-[13px]">{i.texto}</p> : null}
      {i.erro ? <p className="mt-1 text-xs text-destructive">Falha no envio: {i.erro}</p> : null}
    </li>
  )
}

function Ligacao({ i }: { i: Extract<ItemDoHistorico, { tipo: 'ligacao' }> }) {
  return (
    <li className="rounded-md border border-sky-200 p-2.5 text-sm dark:border-sky-900">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Phone className="h-3.5 w-3.5 text-sky-600" aria-hidden />
        <span className="font-medium">Ligação da Ana</span>
        {i.contato ? <span className="text-muted-foreground">para {i.contato}</span> : null}
        <Badge variant={i.status === 'concluida' ? 'success' : i.status === 'falhou' ? 'critical' : 'neutral'}>
          {STATUS_LIGACAO_LABELS[i.status] ?? i.status}
        </Badge>
        {i.duracaoS ? <span className="text-muted-foreground">{Math.round(i.duracaoS / 60)} min</span> : null}
        <span className="ml-auto tabular-nums text-muted-foreground">{dataHora(i.em)}</span>
      </div>
      {i.outcome ? <p className="mt-1 text-xs text-muted-foreground">Desfecho: {i.outcome}</p> : null}
      {i.resumo ? <p className="mt-1 whitespace-pre-wrap text-[13px]">{i.resumo}</p> : null}
      {i.erro ? <p className="mt-1 text-xs text-destructive">{i.erro}</p> : null}
    </li>
  )
}

/** Quem o agente já tentou, por qual canal, quantas vezes, e com que resultado. */
export function ContatosTentados({ bruto }: { bruto: Json | null }) {
  const lista = lerContatosTentados(bruto)
  if (lista.length === 0) {
    return <p className="text-sm text-muted-foreground">O agente ainda não tentou nenhum contato.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium">Contato</th>
            <th className="py-1.5 pr-3 font-medium">Canal</th>
            <th className="py-1.5 pr-3 text-right font-medium">Tentativas</th>
            <th className="py-1.5 pr-3 font-medium">Último resultado</th>
            <th className="py-1.5 font-medium">Quando</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((c) => (
            <tr key={`${c.contato_id}-${c.canal}`} className="border-b last:border-0">
              <td className="py-1.5 pr-3">{c.nome ?? 'Sem nome'}</td>
              <td className="py-1.5 pr-3">{canalLabel(c.canal)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{c.tentativas}</td>
              <td className="py-1.5 pr-3">{c.ultimo_resultado ?? '—'}</td>
              <td className="py-1.5 tabular-nums text-muted-foreground">{dataHora(c.ultima_em)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
