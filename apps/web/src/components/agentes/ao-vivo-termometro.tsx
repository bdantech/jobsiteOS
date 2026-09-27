'use client'

import type { ReactNode } from 'react'
import { CalendarCheck, FileCheck2 } from 'lucide-react'
import { ESTADOS_MANDATO } from '@jobsiteos/core'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { estadoLabel, pct, reais } from './format'
import type { ConfigAoVivo, Termometro } from './queries-operacao'

/**
 * O termômetro (§11.1): mandatos por estado, o que se conseguiu HOJE (reuniões marcadas,
 * NFs convertidas) e o consumo do mês contra o teto.
 *
 * Reuniões e NFs são os dois resultados pelos quais a IA é julgada (§11.5: custo por
 * reunião marcada e por NF convertida). Ficam em número grande porque são a resposta de
 * "valeu a pena hoje?" — a lista de estados é contexto, não manchete.
 *
 * O consumo do mês soma o reservado ao consumido: a reserva é dinheiro que uma ação em
 * voo já tomou do teto (§8), e ignorá-la mostraria folga que o próximo ciclo não vai ter.
 */
export function TermometroAoVivo({
  termometro,
  config,
}: {
  termometro: Termometro | undefined
  config: ConfigAoVivo | undefined
}) {
  if (!termometro || !config) return <Skeleton className="h-64 w-full" />

  const { teto, consumido, reservado, temLinhaDoMes } = config.orcamentoMes
  const comprometido = consumido + reservado
  const p = pct(comprometido, teto)
  const maior = Math.max(1, ...ESTADOS_MANDATO.map((e) => termometro.porEstado[e] ?? 0))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Numero icone={<CalendarCheck className="h-4 w-4" aria-hidden />} rotulo="Reuniões marcadas hoje" valor={termometro.reunioesHoje} />
        <Numero icone={<FileCheck2 className="h-4 w-4" aria-hidden />} rotulo="NFs convertidas hoje" valor={termometro.nfsConvertidasHoje} />
      </div>

      <div className="rounded-lg border p-3">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Consumo do mês</span>
          <span className="tabular-nums">
            <span className="font-medium">{reais(comprometido)}</span>
            <span className="text-muted-foreground"> de {teto > 0 ? reais(teto) : 'teto não definido'}</span>
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className={cn('h-full rounded-full', p >= 95 ? 'bg-destructive' : p >= 80 ? 'bg-amber-500' : 'bg-primary')}
            style={{ width: `${p}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {teto === 0
            ? 'Com teto zero nenhuma ferramenta paga roda. A gestão define o teto em Configurações.'
            : reservado > 0
              ? `${reais(consumido)} consumido + ${reais(reservado)} reservado por ações em andamento.`
              : temLinhaDoMes
                ? `${p}% do teto.`
                : 'Nenhum gasto neste mês ainda.'}
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Mandatos por estado</p>
        <ul className="space-y-1">
          {ESTADOS_MANDATO.map((e) => {
            const n = termometro.porEstado[e] ?? 0
            return (
              <li key={e} className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-2 text-xs">
                <span className="truncate">{estadoLabel(e)}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-primary/70" style={{ width: `${pct(n, maior)}%` }} />
                </span>
                <span className="text-right tabular-nums">{n}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function Numero({ icone, rotulo, valor }: { icone: ReactNode; rotulo: string; valor: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icone}
        {rotulo}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{valor}</p>
    </div>
  )
}
