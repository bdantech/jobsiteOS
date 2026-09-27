'use client'

import Link from 'next/link'
import { Bot } from 'lucide-react'
import {
  ESTADO_AGENTE_AO_VIVO_LABELS,
  lerLimitesAgente,
  type EstadoAgenteAoVivo,
} from '@jobsiteos/core'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { desde, iniciais, pct, reais } from './format'
import {
  cotasUsadas,
  personaDoAgente,
  type AcaoDeHoje,
  type AcaoDoFeed,
  type AgenteVisivel,
  type MandatoAtivo,
} from './queries-operacao'

/**
 * A faixa de agentes do Ao vivo (§11.1): um cartão por vendedor de IA, com o que ele está
 * fazendo, quanto gastou hoje e quanto sobra de cada cota.
 *
 * ─── O ESTADO DO CARTÃO, EM ORDEM DE GRAVIDADE ──────────────────────────────
 *   disjuntor aberto   o agente se parou sozinho por sinal ruim (§9.2) — pede gente
 *   pausado            alguém o pausou, desligou a autonomia ou o inativou
 *   sem linha          não tem WhatsApp: não consegue falar, mesmo querendo
 *   operando           gravou alguma ação (inclusive um ciclo) nos últimos 15 minutos
 *   ocioso             o resto — está ligado, mas o ciclo não achou o que fazer
 *
 * A ordem importa: um agente com disjuntor aberto e sem linha tem de aparecer como
 * disjuntor aberto, porque é o que exige alguém agora.
 */

const JANELA_OPERANDO_MS = 15 * 60_000

export interface DisjuntorResumo {
  agente_id: string
  estado: string
  aberto_em: string | null
  aberto_motivo: string | null
}

export function estadoDoAgente(
  a: AgenteVisivel,
  disjuntor: DisjuntorResumo | undefined,
  ultimaAcaoEm: string | undefined,
): EstadoAgenteAoVivo {
  if (disjuntor?.estado === 'aberto') return 'disjuntor_aberto'
  if (a.pausado_em || !a.autonomo || !a.ativo) return 'pausado'
  if (!a.whatsapp_conta_id) return 'sem_linha'
  if (ultimaAcaoEm && Date.now() - new Date(ultimaAcaoEm).getTime() <= JANELA_OPERANDO_MS) return 'operando'
  return 'ocioso'
}

const TOM_DO_ESTADO: Record<EstadoAgenteAoVivo, 'success' | 'neutral' | 'warning' | 'critical' | 'info'> = {
  operando: 'success',
  ocioso: 'neutral',
  pausado: 'warning',
  disjuntor_aberto: 'critical',
  sem_linha: 'warning',
}

export function FaixaDeAgentes({
  agentes,
  disjuntores,
  acoesHoje,
  feed,
  ativos,
  fotos,
  gestor,
}: {
  agentes: AgenteVisivel[]
  disjuntores: DisjuntorResumo[]
  acoesHoje: AcaoDeHoje[]
  feed: AcaoDoFeed[]
  ativos: MandatoAtivo[]
  fotos: Record<string, string>
  gestor: boolean
}) {
  if (agentes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <Bot className="mx-auto mb-2 h-6 w-6" aria-hidden />
        {gestor ? (
          <>
            <p className="font-medium text-foreground">Nenhum vendedor de IA cadastrado ainda.</p>
            <p className="mt-1">
              Um agente é um vendedor com persona, linha de WhatsApp, closer e cotas.{' '}
              <Link href="/agentes/personas" className="underline underline-offset-2">
                Crie o primeiro em Personas
              </Link>
              .
            </p>
          </>
        ) : (
          <>
            <p className="font-medium text-foreground">Nenhum agente sob o seu acompanhamento.</p>
            <p className="mt-1">
              Aqui aparecem os agentes de que você é o closer designado (titular ou substituto). Quem define isso é
              a gestão comercial, em Personas.
            </p>
          </>
        )}
      </div>
    )
  }

  const disjuntorPor = new Map(disjuntores.map((d) => [d.agente_id, d]))

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {agentes.map((a) => {
        // `acoesHoje` vem do mais recente para o mais antigo: o primeiro do agente é o último.
        const ultima = acoesHoje.find((x) => x.agente_id === a.id)
        const agora = feed.find((x) => x.agente_id === a.id)
        const estado = estadoDoAgente(a, disjuntorPor.get(a.id), ultima?.executada_em)
        const gastoHoje = acoesHoje
          .filter((x) => x.agente_id === a.id)
          .reduce((s, x) => s + (x.custo_centavos ?? 0), 0)
        const limites = lerLimitesAgente(a.limites)
        const usadas = cotasUsadas(acoesHoje, a.id)
        const mandatos = ativos.filter((m) => m.agente_id === a.id).length
        const persona = personaDoAgente(a)
        const foto = persona.fotoPath ? fotos[persona.fotoPath] : undefined
        const disj = disjuntorPor.get(a.id)

        return (
          <div
            key={a.id}
            className={cn(
              'space-y-3 rounded-lg border bg-card p-3',
              estado === 'disjuntor_aberto' && 'border-red-300 dark:border-red-900',
              estado === 'operando' && 'border-emerald-300 dark:border-emerald-900',
            )}
          >
            <div className="flex items-start gap-3">
              <Avatar className="h-11 w-11">
                {foto ? <AvatarImage src={foto} alt={persona.nome} /> : null}
                <AvatarFallback>{iniciais(persona.nome)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{persona.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {a.tipo === 'originador' ? 'Originador' : 'SDR'}
                  {a.modo_rodagem === 'piloto' ? ' · piloto' : ''}
                </p>
              </div>
              <Badge variant={TOM_DO_ESTADO[estado]} className="shrink-0">
                {estado === 'operando' ? <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> : null}
                {ESTADO_AGENTE_AO_VIVO_LABELS[estado]}
              </Badge>
            </div>

            <div className="min-h-[2.5rem] text-xs">
              {estado === 'disjuntor_aberto' ? (
                <p className="text-destructive">
                  {disj?.aberto_motivo ?? 'Parou sozinho por sinal ruim.'}
                  {disj?.aberto_em ? ` · ${desde(disj.aberto_em)}` : ''}
                </p>
              ) : estado === 'pausado' ? (
                <p className="text-amber-700 dark:text-amber-400">
                  {!a.ativo ? 'Inativo.' : a.pausado_em ? (a.pausado_motivo ?? 'Pausado por uma pessoa.') : 'Autonomia desligada.'}
                </p>
              ) : agora ? (
                <p className="line-clamp-2" title={agora.intencao}>
                  <span className="text-muted-foreground">{desde(agora.executada_em)}: </span>
                  {agora.intencao}
                </p>
              ) : (
                <p className="text-muted-foreground">Nenhuma ação recente.</p>
              )}
            </div>

            <div className="flex items-center justify-between text-xs">
              <span>
                <span className="font-medium tabular-nums">{mandatos}</span>
                <span className="text-muted-foreground"> de {limites.mandatos_ativos} mandatos ativos</span>
              </span>
              <span className="tabular-nums" title="Soma do custo de todas as ações e ciclos de hoje">
                {reais(gastoHoje)}
                {limites.gasto_diario_centavos > 0 ? (
                  <span className="text-muted-foreground"> / {reais(limites.gasto_diario_centavos)}</span>
                ) : (
                  <span className="text-muted-foreground"> hoje</span>
                )}
              </span>
            </div>

            <div className="space-y-1.5">
              <BarraDeCota rotulo="Ligações" usado={usadas.ligacoes} limite={limites.ligacoes_por_dia} />
              <BarraDeCota rotulo="WhatsApp" usado={usadas.mensagens} limite={limites.mensagens_por_dia} />
              <BarraDeCota rotulo="E-mails" usado={usadas.emails} limite={limites.emails_por_dia} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Cota do dia: a barra enche com o USADO, e o número diz quanto resta — é o que se decide. */
function BarraDeCota({ rotulo, usado, limite }: { rotulo: string; usado: number; limite: number }) {
  const p = pct(usado, limite)
  const resta = Math.max(0, limite - usado)
  return (
    <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-[11px]">
      <span className="text-muted-foreground">{rotulo}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={cn('h-full rounded-full', p >= 100 ? 'bg-destructive' : p >= 80 ? 'bg-amber-500' : 'bg-primary')}
          style={{ width: `${limite > 0 ? p : 0}%` }}
        />
      </div>
      <span className="tabular-nums" aria-label={`${rotulo}: ${usado} de ${limite}, restam ${resta}`}>
        {limite > 0 ? `${usado}/${limite}` : 'cota zero'}
      </span>
    </div>
  )
}
