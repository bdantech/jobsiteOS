'use client'

import { useQuery } from '@tanstack/react-query'
import { Cpu, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { dataHora, ferramentaLabel, reais } from './format'
import { agentesOpKeys, buscarAcoesDoMandato, type AcaoDoMandato } from './queries-operacao'

/**
 * A linha do tempo de TODAS as ações do mandato, mais recente no topo.
 *
 * As linhas `ciclo` aparecem aqui (e não no feed Ao vivo): são o custo de DECIDIR, com os
 * tokens de entrada e saída. Ficam discretas, como linha de custo — é a auditoria de
 * quanto custou pensar, separada de quanto custou agir, e é por elas que se descobre um
 * mandato que gasta R$ 2 de modelo para mandar um WhatsApp de R$ 0,02.
 *
 * Falha fica visível com o erro por extenso. Um agente que "tentou e não conseguiu" sem
 * dizer por quê é pior que um que não tentou.
 */
export function LinhaDoTempoDoMandato({ mandatoId }: { mandatoId: string }) {
  const acoes = useQuery({ queryKey: agentesOpKeys.acoesDoMandato(mandatoId), queryFn: () => buscarAcoesDoMandato(mandatoId) })

  if (acoes.isPending) return <Skeleton className="h-48 w-full" />
  if (acoes.isError) {
    return (
      <p className="text-sm text-destructive">
        {acoes.error instanceof Error ? acoes.error.message : 'Erro ao carregar as ações.'}
      </p>
    )
  }
  const lista = acoes.data ?? []
  if (lista.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nenhuma ação ainda. O ciclo do agente pega este mandato na próxima rodada — a cada poucos minutos,
        dentro da janela de envio.
      </p>
    )
  }

  const custoModelo = lista.filter((a) => a.ferramenta === 'ciclo').reduce((s, a) => s + (a.custo_centavos ?? 0), 0)
  const custoAcoes = lista.filter((a) => a.ferramenta !== 'ciclo').reduce((s, a) => s + (a.custo_centavos ?? 0), 0)

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {lista.length} linha(s) · modelo {reais(custoModelo)} · ferramentas {reais(custoAcoes)}
      </p>
      <ol className="relative space-y-2 border-l pl-4">
        {lista.map((a) => (a.ferramenta === 'ciclo' ? <LinhaDeCiclo key={a.id} a={a} /> : <LinhaDeAcao key={a.id} a={a} />))}
      </ol>
    </div>
  )
}

function LinhaDeAcao({ a }: { a: AcaoDoMandato }) {
  const falhou = a.sucesso === false
  return (
    <li className="relative">
      <span
        className={cn(
          'absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background',
          falhou ? 'bg-destructive' : a.sucesso ? 'bg-emerald-500' : 'bg-muted-foreground/50',
        )}
        aria-hidden
      />
      <div className={cn('rounded-md border p-2.5 text-sm', falhou && 'border-red-200 dark:border-red-900')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{ferramentaLabel(a.ferramenta)}</span>
          {a.contatos?.nome ? <span className="text-muted-foreground">· {a.contatos.nome}</span> : null}
          {falhou ? (
            <Badge variant="critical" className="gap-1">
              <XCircle className="h-3 w-3" aria-hidden />
              Falhou
            </Badge>
          ) : null}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            #{a.sequencia} · {dataHora(a.executada_em)}
            {a.custo_centavos ? ` · ${reais(a.custo_centavos)}` : ''}
          </span>
        </div>
        <p className="mt-1 text-[13px]">{a.intencao}</p>
        {falhou && a.erro ? <p className="mt-1 text-xs text-destructive">{a.erro}</p> : null}
      </div>
    </li>
  )
}

function LinhaDeCiclo({ a }: { a: AcaoDoMandato }) {
  const entrada = a.tokens_entrada ?? 0
  const saida = a.tokens_saida ?? 0
  return (
    <li className="relative">
      <span className="absolute -left-[19px] top-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/40" aria-hidden />
      <p
        className={cn(
          'flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground',
          a.sucesso === false && 'text-destructive',
        )}
      >
        <Cpu className="h-3 w-3" aria-hidden />
        <span>{a.intencao}</span>
        <span className="tabular-nums">
          {milhares(entrada)} tokens de entrada · {milhares(saida)} de saída · {reais(a.custo_centavos)}
        </span>
        <span className="ml-auto tabular-nums">{dataHora(a.executada_em)}</span>
      </p>
      {a.sucesso === false && a.erro ? <p className="text-xs text-destructive">{a.erro}</p> : null}
    </li>
  )
}

function milhares(n: number): string {
  return n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(n)
}
