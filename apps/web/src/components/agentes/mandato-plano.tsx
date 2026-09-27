'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Compass, Phone, ShieldAlert } from 'lucide-react'
import type { Json } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { acaoPlanoLabel, daqui, dataHora } from './format'
import { agentesOpKeys, buscarVersoesDoPlano, lerPlano } from './queries-operacao'

/**
 * O plano explícito do mandato (§2.2), em destaque no topo do modal.
 *
 * É requisito de produto, não enfeite: em qualquer momento tem de estar claro o que o
 * agente está tentando e POR QUÊ. É o que torna a autonomia supervisionável sem aprovar
 * mensagem por mensagem — quem abre o mandato lê o plano antes da linha do tempo, porque
 * o plano diz para onde as ações estão indo, e a linha do tempo só diz onde já foram.
 *
 * Plano ilegível (JSON fora do schema) é mostrado como tal, e não escondido: um agente
 * que grava plano torto é exatamente o agente que precisa ser auditado.
 */
export function PlanoAtual({ bruto, versao }: { bruto: Json | null; versao: number }) {
  const plano = lerPlano(bruto)

  if (!bruto) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Ainda sem plano.</p>
        <p className="mt-1">
          O agente escreve o plano no primeiro ciclo de decisão sobre este mandato — `atualizar_plano` é
          obrigatório em todo ciclo. Se o mandato é novo, espere o próximo ciclo (a cada poucos minutos).
        </p>
      </div>
    )
  }

  if (!plano) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="font-medium">O plano gravado não segue o formato esperado.</p>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(bruto, null, 2)}</pre>
      </div>
    )
  }

  const confianca = Math.round(plano.confianca * 100)

  return (
    <div className="space-y-3 rounded-lg border-2 border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Compass className="h-3.5 w-3.5" aria-hidden />
            Plano atual · v{versao}
          </p>
          <p className="mt-1 text-sm font-semibold">{plano.objetivo_atual}</p>
        </div>
        <Badge
          variant={confianca >= 70 ? 'success' : confianca >= 40 ? 'warning' : 'critical'}
          title="Confiança do próprio agente de que o plano leva ao objetivo"
        >
          Confiança {confianca}%
        </Badge>
      </div>

      {plano.hipotese ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Hipótese: </span>
          {plano.hipotese}
        </p>
      ) : null}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Próximas ações</p>
        {plano.proximas_acoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ação prevista — o agente espera um retorno.</p>
        ) : (
          <ol className="space-y-2">
            {plano.proximas_acoes.map((a, i) => (
              <li
                key={`${a.acao}-${a.quando}-${i}`}
                className={cn(
                  'rounded-md border bg-background p-2.5 text-sm',
                  a.acao === 'ligar' && 'border-sky-300 dark:border-sky-800',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {a.acao === 'ligar' ? <Phone className="h-3.5 w-3.5 text-sky-600" aria-hidden /> : null}
                  <span className="font-medium">{acaoPlanoLabel(a.acao)}</span>
                  {a.contato ? <span className="text-muted-foreground">· {a.contato}</span> : null}
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground" title={a.quando}>
                    {quandoLegivel(a.quando)}
                  </span>
                </div>
                <p className="mt-1 text-[13px]">
                  <span className="text-muted-foreground">Por quê: </span>
                  {a.por_que}
                </p>
                {a.condicao ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">Condição: {a.condicao}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      {plano.bloqueios.length > 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <p className="flex items-center gap-1.5 font-medium">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
            Bloqueios
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {plano.bloqueios.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/** `quando` é texto livre do modelo (ISO na prática). Data válida vira "27/09 15:30 · em 2 h". */
function quandoLegivel(quando: string): string {
  const d = new Date(quando)
  if (Number.isNaN(d.getTime())) return quando
  return `${dataHora(quando)} · ${daqui(quando)}`
}

/**
 * A evolução do plano (`mandato_plano_versoes`). Fechada por padrão e carregada só ao
 * abrir: é ferramenta de auditoria — "por que o agente mudou de ideia?" — e não o que se
 * lê todo dia. Cada versão guarda o motivo da mudança, que é a parte que importa.
 */
export function VersoesDoPlano({ mandatoId, versaoAtual }: { mandatoId: string; versaoAtual: number }) {
  const [aberto, setAberto] = React.useState(false)
  const [expandida, setExpandida] = React.useState<string | null>(null)
  const versoes = useQuery({
    queryKey: agentesOpKeys.versoes(mandatoId),
    queryFn: () => buscarVersoesDoPlano(mandatoId),
    enabled: aberto,
  })

  if (versaoAtual <= 1 && !aberto) {
    return <p className="text-xs text-muted-foreground">O plano ainda não mudou desde a primeira versão.</p>
  }

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-medium"
        aria-expanded={aberto}
      >
        {aberto ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        Versões do plano
        <span className="font-normal text-muted-foreground">({versaoAtual})</span>
      </button>
      {aberto ? (
        <div className="border-t px-3 py-2">
          {versoes.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : versoes.isError ? (
            <p className="text-sm text-destructive">
              {versoes.error instanceof Error ? versoes.error.message : 'Erro ao carregar as versões.'}
            </p>
          ) : (versoes.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma versão gravada.</p>
          ) : (
            <ol className="space-y-1.5">
              {(versoes.data ?? []).map((v) => {
                const p = lerPlano(v.plano)
                const aberta = expandida === v.id
                return (
                  <li key={v.id} className="text-sm">
                    <button
                      type="button"
                      className="flex w-full flex-wrap items-baseline gap-x-2 text-left hover:underline"
                      onClick={() => setExpandida(aberta ? null : v.id)}
                      aria-expanded={aberta}
                    >
                      <span className="font-mono text-xs">v{v.versao}</span>
                      <span className="text-xs text-muted-foreground">{dataHora(v.criado_em)}</span>
                      <span className="min-w-0 flex-1">{v.motivo}</span>
                    </button>
                    {aberta ? (
                      <div className="mt-1 rounded-md bg-muted/50 p-2 text-xs">
                        {p ? (
                          <>
                            <p className="font-medium">{p.objetivo_atual}</p>
                            {p.hipotese ? <p className="mt-0.5 text-muted-foreground">{p.hipotese}</p> : null}
                            <ul className="mt-1 list-disc pl-4">
                              {p.proximas_acoes.map((a, i) => (
                                <li key={i}>
                                  {acaoPlanoLabel(a.acao)}
                                  {a.contato ? ` · ${a.contato}` : ''} — {a.por_que}
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <pre className="whitespace-pre-wrap">{JSON.stringify(v.plano, null, 2)}</pre>
                        )}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  )
}
