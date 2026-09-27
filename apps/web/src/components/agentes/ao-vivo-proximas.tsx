'use client'

import { Phone } from 'lucide-react'
import { OBJETIVO_LIGACAO_LABELS, type ObjetivoLigacao } from '@jobsiteos/core'
import { cn } from '@/lib/utils'
import { acaoPlanoLabel, daqui, hora } from './format'
import {
  lerPlano,
  nomeDaEmpresa,
  personaDoAgente,
  type AgenteVisivel,
  type LigacaoNaFila,
  type MandatoAtivo,
} from './queries-operacao'

/**
 * "Próximas 2 horas" — o que os agentes vão fazer em seguida (§11.1), com as ligações em
 * destaque: ligação é a ação mais cara e a única que alguém do outro lado vive em tempo
 * real, então é a que o gestor quer ver chegando.
 *
 * Duas fontes, juntas pelo relógio:
 *   mandatos ativos com `proxima_acao_em` até daqui a 2 h — com a primeira ação do plano
 *     (o quê e por quê). Os ATRASADOS entram também: são os próximos da fila do ciclo.
 *   ligações de mandato ainda `a_enviar` — já pedidas à Ana, esperando sair.
 */

const HORIZONTE_MS = 2 * 60 * 60_000
const MAXIMO = 40

interface Item {
  chave: string
  em: string
  mandatoId: string
  ligacao: boolean
  titulo: string
  porQue: string | null
  empresa: string
  agente: string
}

export function ProximasDuasHoras({
  ativos,
  ligacoes,
  agentes,
  onAbrir,
}: {
  ativos: MandatoAtivo[]
  ligacoes: LigacaoNaFila[]
  agentes: AgenteVisivel[]
  onAbrir: (mandatoId: string) => void
}) {
  const limite = Date.now() + HORIZONTE_MS
  const nomePor = new Map(agentes.map((a) => [a.id, personaDoAgente(a).nome]))
  const mandatoPor = new Map(ativos.map((m) => [m.id, m]))

  const itens: Item[] = []
  for (const m of ativos) {
    if (!m.proxima_acao_em || new Date(m.proxima_acao_em).getTime() > limite) continue
    const proxima = lerPlano(m.plano)?.proximas_acoes[0]
    itens.push({
      chave: `m-${m.id}`,
      em: m.proxima_acao_em,
      mandatoId: m.id,
      ligacao: proxima?.acao === 'ligar',
      titulo: proxima
        ? `${acaoPlanoLabel(proxima.acao)}${proxima.contato ? ` · ${proxima.contato}` : ''}`
        : 'Próximo ciclo de decisão',
      porQue: proxima?.por_que ?? m.objetivo,
      empresa: nomeDaEmpresa(m.empresas),
      agente: nomePor.get(m.agente_id) ?? 'Agente',
    })
  }
  for (const l of ligacoes) {
    if (!l.mandato_id) continue
    const em = l.agendada_para ?? l.criada_em
    if (new Date(em).getTime() > limite) continue
    const m = mandatoPor.get(l.mandato_id)
    itens.push({
      chave: `l-${l.id}`,
      em,
      mandatoId: l.mandato_id,
      ligacao: true,
      titulo: `Ligação na fila da Ana${l.contatos?.nome ? ` · ${l.contatos.nome}` : ''}`,
      porQue: l.objetivo ? (OBJETIVO_LIGACAO_LABELS[l.objetivo as ObjetivoLigacao] ?? l.objetivo) : null,
      empresa: m ? nomeDaEmpresa(m.empresas) : 'Mandato',
      agente: m ? (nomePor.get(m.agente_id) ?? 'Agente') : 'Agente',
    })
  }
  itens.sort((a, b) => a.em.localeCompare(b.em))

  if (itens.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        Nada agendado para as próximas 2 horas. Mandatos aguardando retorno do cliente não têm hora marcada — voltam
        quando chega uma resposta.
      </p>
    )
  }

  return (
    <ol className="space-y-1.5">
      {itens.slice(0, MAXIMO).map((i) => (
        <li key={i.chave}>
          <button
            type="button"
            onClick={() => onAbrir(i.mandatoId)}
            className={cn(
              'flex w-full gap-2.5 rounded-md border px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted/50',
              i.ligacao && 'border-sky-300 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/30',
            )}
          >
            <span className="w-11 shrink-0 text-xs tabular-nums">
              <span className="block font-medium">{hora(i.em)}</span>
              <span className="block text-[10.5px] text-muted-foreground">{daqui(i.em)}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-medium">
                {i.ligacao ? <Phone className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-label="Ligação" /> : null}
                <span className="truncate">{i.titulo}</span>
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {i.agente} · {i.empresa}
              </span>
              {i.porQue ? <span className="line-clamp-2 block text-xs">{i.porQue}</span> : null}
            </span>
          </button>
        </li>
      ))}
      {itens.length > MAXIMO ? (
        <li className="text-center text-xs text-muted-foreground">e mais {itens.length - MAXIMO} na fila</li>
      ) : null}
    </ol>
  )
}
