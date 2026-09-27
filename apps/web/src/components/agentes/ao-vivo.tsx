'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, OctagonX, Phone, Radio } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { FaixaDeAgentes } from './ao-vivo-agentes'
import { FeedAoVivo } from './ao-vivo-feed'
import { ProximasDuasHoras } from './ao-vivo-proximas'
import { TermometroAoVivo } from './ao-vivo-termometro'
import { MandatoModal } from './mandato-modal'
import { useParamDaUrl } from './mandato-url'
import {
  agentesOpKeys,
  buscarAcoesDeHoje,
  buscarConfigAoVivo,
  buscarDisjuntores,
  buscarFeed,
  buscarLigacoesNaFila,
  buscarMandatosAtivos,
  buscarTermometro,
  personaDoAgente,
  useAgentes,
  useAgentesRealtime,
  useFotosDosAgentes,
  usePermissoesAgentes,
} from './queries-operacao'

/**
 * Ao vivo (§11.1) — a aba padrão dos Agentes, feita para ficar aberta num monitor.
 *
 * ─── TEMPO REAL, COM REDE DE SEGURANÇA ──────────────────────────────────────
 * O feed e os mandatos chegam por Realtime (`useAgentesRealtime`). Mas um monitor fica
 * aberto o dia inteiro, e o socket cai (Wi-Fi, notebook dormindo, token girando): cada
 * consulta tem também um `refetchInterval`. Se o Realtime está de pé, o intervalo não muda
 * nada; se caiu, a tela continua andando — atrasada em um minuto, e não congelada às 9h.
 * O indicador "ao vivo" no topo diz qual dos dois está valendo.
 *
 * O disjuntor, a pausa do agente e a config não estão na publicação do Realtime: são
 * lidos por intervalo.
 *
 * ─── O RELÓGIO ──────────────────────────────────────────────────────────────
 * "há 3 min", "em 25 min" e o próprio estado "operando" (ação nos últimos 15 minutos)
 * dependem da hora, não dos dados. Um tique de 30 s re-renderiza a tela sem ir ao banco.
 *
 * Clicar em qualquer ação ou mandato abre o MODAL (`?m=<id>`); a tela nunca muda.
 */
export function AoVivo() {
  const [mandatoAberto, setMandatoAberto] = useParamDaUrl('m')
  const conectado = useAgentesRealtime('ao-vivo')
  useTique(30_000)

  const permissoes = usePermissoesAgentes()
  const agentes = useAgentes()
  const disjuntores = useQuery({ queryKey: agentesOpKeys.disjuntores(), queryFn: buscarDisjuntores, refetchInterval: 60_000 })
  const feed = useQuery({ queryKey: agentesOpKeys.feed(), queryFn: () => buscarFeed(), refetchInterval: 60_000 })
  const hoje = useQuery({ queryKey: agentesOpKeys.acoesHoje(), queryFn: buscarAcoesDeHoje, refetchInterval: 60_000 })
  const ativos = useQuery({ queryKey: agentesOpKeys.ativos(), queryFn: buscarMandatosAtivos, refetchInterval: 60_000 })
  const ligacoes = useQuery({
    queryKey: agentesOpKeys.ligacoesNaFila(),
    queryFn: buscarLigacoesNaFila,
    refetchInterval: 60_000,
  })
  const termometro = useQuery({ queryKey: agentesOpKeys.termometro(), queryFn: buscarTermometro, refetchInterval: 60_000 })
  const config = useQuery({ queryKey: agentesOpKeys.config(), queryFn: buscarConfigAoVivo, refetchInterval: 5 * 60_000 })

  const listaAgentes = React.useMemo(() => agentes.data ?? [], [agentes.data])
  const paths = React.useMemo(
    () => listaAgentes.map((a) => personaDoAgente(a).fotoPath).filter((p): p is string => Boolean(p)),
    [listaAgentes],
  )
  const fotos = useFotosDosAgentes(paths)

  const erro = [agentes, feed, hoje, ativos, termometro, config].find((q) => q.isError)?.error

  return (
    <div className="space-y-4">
      {config.data?.killSwitch ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border-2 border-red-400 bg-red-50 p-4 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100"
        >
          <OctagonX className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Kill switch ligado — nenhum agente está agindo.</p>
            <p className="text-sm">
              Todo o automático está parado: ciclos, envios e ligações. Os mandatos ficam onde estão e retomam
              quando a gestão desligar o kill switch em Configurações.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn('inline-flex items-center gap-1.5', conectado ? 'text-emerald-700 dark:text-emerald-400' : '')}
            title={
              conectado
                ? 'Recebendo as ações no instante em que acontecem.'
                : 'Sem conexão em tempo real: a tela se atualiza a cada minuto.'
            }
          >
            <Radio className={cn('h-3.5 w-3.5', conectado && 'animate-pulse')} aria-hidden />
            {conectado ? 'Ao vivo' : 'Atualizando a cada minuto'}
          </span>
        </div>
        {config.data ? <VersaoDaAna versao={config.data.versaoVoz} /> : null}
      </div>

      {erro ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {erro instanceof Error ? erro.message : 'Erro ao carregar o Ao vivo.'}
        </div>
      ) : null}

      <section aria-labelledby="faixa-agentes">
        <h2 id="faixa-agentes" className="sr-only">
          Agentes
        </h2>
        {agentes.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-52 w-full" />
            ))}
          </div>
        ) : (
          <FaixaDeAgentes
            agentes={listaAgentes}
            disjuntores={disjuntores.data ?? []}
            acoesHoje={hoje.data ?? []}
            feed={feed.data ?? []}
            ativos={ativos.data ?? []}
            fotos={fotos.data ?? {}}
            gestor={permissoes.data?.gestor === true}
          />
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Agora</CardTitle>
            <CardDescription>O que os agentes estão fazendo, e por quê. Clique para abrir o mandato.</CardDescription>
          </CardHeader>
          <CardContent>
            {feed.isPending ? (
              <Skeleton className="h-96 w-full" />
            ) : (
              <FeedAoVivo acoes={feed.data ?? []} agentes={listaAgentes} onAbrir={setMandatoAberto} />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                Próximas 2 horas
                <span className="inline-flex items-center gap-1 text-xs font-normal text-sky-700 dark:text-sky-400">
                  <Phone className="h-3 w-3" aria-hidden />
                  ligações em destaque
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ativos.isPending ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <ProximasDuasHoras
                  ativos={ativos.data ?? []}
                  ligacoes={ligacoes.data ?? []}
                  agentes={listaAgentes}
                  onAbrir={setMandatoAberto}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Termômetro</CardTitle>
            </CardHeader>
            <CardContent>
              <TermometroAoVivo termometro={termometro.data} config={config.data} />
            </CardContent>
          </Card>
        </div>
      </div>

      <MandatoModal mandatoId={mandatoAberto} onFechar={() => setMandatoAberto(null)} />
    </div>
  )
}

/**
 * A versão da Ana decide o que a voz consegue fazer (§4.3, §15.4). Na v1, por telefone só
 * a oferta de antecipação de uma NF é garantida — agendar, qualificar e reativar por
 * ligação voltam recusados e o agente usa outro canal. Quem lê o feed precisa saber disso
 * para não estranhar um agente de agendamento que nunca liga.
 */
function VersaoDaAna({ versao }: { versao: string | null }) {
  const v2 = versao === 'v2'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs',
        v2 ? 'text-muted-foreground' : 'border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300',
      )}
      title={versao ? `Versão informada pela API de voz: ${versao}` : 'A API de voz ainda não informou a versão.'}
    >
      <Phone className="h-3 w-3" aria-hidden />
      {v2 ? 'Ana v2 — todos os objetivos por telefone' : 'Ana v1 — por telefone só a oferta de NF'}
    </span>
  )
}

function useTique(ms: number) {
  const [, setN] = React.useState(0)
  React.useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}
