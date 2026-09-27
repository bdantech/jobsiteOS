import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { AbaixoDoCabecalho, useRecuoDoCabecalho } from '@/components/shell/cabecalho-de-vidro'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FiltroSegmentado, type OpcaoFiltro } from '@/components/ui/filtros'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import {
  agentesKeys,
  buscarAcoesDoMandato,
  buscarLigacoesDoMandato,
  buscarMandato,
  ehIdDeMandato,
  lerPlano,
} from '../api'
import {
  brlCentavos,
  dataHora,
  DESFECHO_LIGACAO_LABELS,
  duracaoTexto,
  estadoMandatoLabel,
  ferramentaLabel,
  MOTIVO_PAUSA_LABELS,
  motivoEncerramentoLabel,
  nomeDoAgente,
  proximaAcaoTexto,
  quandoDoPlano,
  STATUS_LIGACAO_LABELS,
  tipoMandatoLabel,
  varianteEstadoMandato,
  varianteStatusLigacao,
} from '../format'
import { useAcoesAoVivo } from '../realtime'

/**
 * O mandato no celular (09 §11 Mobile), só leitura.
 *
 * ─── O PLANO VEM ANTES DA HISTÓRIA ──────────────────────────────────────────
 * O requisito do §2.2 é que, a qualquer momento, esteja claro o que o agente está
 * tentando e por quê. É o que torna a autonomia supervisionável sem aprovar mensagem
 * por mensagem — e por isso o plano atual é o cartão em destaque, logo abaixo da capa.
 * O que ele JÁ fez (as ações, com a intenção de cada uma) vem depois.
 *
 * É também a tela que o push de escalação abre (`/agentes/mandatos?m=<id>`): quem chega
 * por ele quer saber por que o agente devolveu o mandato, e a resposta está no plano
 * (bloqueios) e na última ação (a intenção do `escalar_humano`).
 *
 * Pausar, assumir, encerrar e reatribuir é pela web — a tela diz isso em vez de esconder.
 */

type Aba = 'acoes' | 'ligacoes'

const ABAS: readonly OpcaoFiltro<Aba>[] = [
  { valor: 'acoes', label: 'Ações' },
  { valor: 'ligacoes', label: 'Ligações' },
]

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <View className="flex-row justify-between gap-3 py-1">
      <Text className="text-sm text-muted-foreground">{rotulo}</Text>
      <Text className="flex-1 text-right text-sm">{valor}</Text>
    </View>
  )
}

/** A barra de gasto: vermelha acima de 90% — o mandato está a uma ligação de pausar sozinho. */
function Barra({ fracao }: { fracao: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, fracao)) * 100)
  return (
    <View className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <View
        className={cn('h-2 rounded-full', pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-amber-500' : 'bg-primary')}
        style={{ width: `${pct}%` }}
      />
    </View>
  )
}

export function MandatoDetalheMobile({ mandatoId }: { mandatoId: string }) {
  const { colors } = useTheme()
  const recuo = useRecuoDoCabecalho()
  const qc = useQueryClient()
  const [aba, setAba] = React.useState<Aba>('acoes')
  const valido = ehIdDeMandato(mandatoId)

  const mandato = useQuery({
    queryKey: agentesKeys.mandato(mandatoId),
    queryFn: () => buscarMandato(mandatoId),
    enabled: valido,
  })
  const acoes = useQuery({
    queryKey: agentesKeys.acoes(mandatoId),
    queryFn: () => buscarAcoesDoMandato(mandatoId),
    enabled: valido,
  })
  const ligacoes = useQuery({
    queryKey: agentesKeys.ligacoes(mandatoId),
    queryFn: () => buscarLigacoesDoMandato(mandatoId),
    enabled: valido && aba === 'ligacoes',
  })

  // Toda mudança do plano passa por uma ação (`atualizar_plano` é obrigatória em todo
  // ciclo), então uma ação nova DESTE mandato é o sinal para reler plano, gasto e estado.
  useAcoesAoVivo(
    () => {
      void qc.invalidateQueries({ queryKey: agentesKeys.mandato(mandatoId) })
      void qc.invalidateQueries({ queryKey: agentesKeys.acoes(mandatoId) })
      void qc.invalidateQueries({ queryKey: agentesKeys.ligacoes(mandatoId) })
    },
    (acao) => acao.mandato_id === mandatoId,
  )

  /*
   * No celular, `/agentes/<qualquer coisa>` cai aqui — inclusive as seções que só a web
   * tem (`/agentes/personas`, `/agentes/config`, `/agentes/desempenho`), que a barra de
   * IA devolve como rota. Em vez de uma consulta que falharia com "uuid inválido", a
   * tela diz onde aquilo mora.
   */
  if (!valido) {
    return (
      <AbaixoDoCabecalho>
        <EmptyState
          title="Esta seção é da web"
          description="Personas, materiais, desempenho e configurações dos agentes ficam na web. No celular: Ao vivo e Mandatos."
        />
      </AbaixoDoCabecalho>
    )
  }

  if (mandato.isPending) {
    return (
      <AbaixoDoCabecalho>
        <View className="gap-3 p-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </View>
      </AbaixoDoCabecalho>
    )
  }

  if (mandato.isError) {
    return (
      <AbaixoDoCabecalho>
        <ErrorState title="Não foi possível carregar o mandato" onRetry={() => void mandato.refetch()} />
      </AbaixoDoCabecalho>
    )
  }

  const m = mandato.data
  if (!m) {
    return (
      <AbaixoDoCabecalho>
        <EmptyState
          title="Mandato não encontrado"
          description="Ele pode não estar no seu alcance: fora da gestão, cada um vê os mandatos dos agentes de que é o closer."
        />
      </AbaixoDoCabecalho>
    )
  }

  const plano = lerPlano(m.plano)
  const terminal = m.estado === 'concluido' || m.estado === 'escalado' || m.estado === 'encerrado_sem_sucesso'
  const motivo = motivoEncerramentoLabel(m.motivo_encerramento)
  const fracaoGasto = m.orcamento_centavos > 0 ? m.gasto_centavos / m.orcamento_centavos : m.gasto_centavos > 0 ? 1 : 0
  const atualizando = mandato.isRefetching || acoes.isRefetching || ligacoes.isRefetching

  return (
    <ScrollView
      contentContainerClassName="gap-4 p-4 pb-28"
      contentContainerStyle={{ paddingTop: recuo + 16 }}
      refreshControl={
        <RefreshControl
          refreshing={atualizando}
          onRefresh={() => {
            void mandato.refetch()
            void acoes.refetch()
            if (aba === 'ligacoes') void ligacoes.refetch()
          }}
          tintColor={colors.primary}
        />
      }
    >
      {/* ── Capa ── */}
      <Card>
        <CardHeader>
          <CardTitle>{m.empresa?.razao_social ?? '—'}</CardTitle>
          <Text className="text-xs text-muted-foreground">
            {m.codigo ?? '—'} · {tipoMandatoLabel(m.tipo)} · {nomeDoAgente(m.agente)}
          </Text>
        </CardHeader>
        <CardContent>
          <View className="mb-2 flex-row flex-wrap gap-2">
            <Badge variant={varianteEstadoMandato(m.estado)}>
              <Text>{estadoMandatoLabel(m.estado)}</Text>
            </Badge>
            {m.estado === 'pausado' && m.pausado_motivo ? (
              <Badge variant="outline">
                <Text>{MOTIVO_PAUSA_LABELS[m.pausado_motivo] ?? m.pausado_motivo}</Text>
              </Badge>
            ) : null}
          </View>
          <Text className="text-sm">{m.objetivo}</Text>
          {terminal && (motivo || m.resultado) ? (
            <View className="mt-3 rounded-lg bg-muted/60 p-3">
              {motivo ? <Text className="text-sm font-medium">{motivo}</Text> : null}
              {m.resultado ? <Text className="mt-0.5 text-sm text-muted-foreground">{m.resultado}</Text> : null}
            </View>
          ) : null}
          <View className="mt-3">
            {!terminal ? <Linha rotulo="Próxima ação" valor={proximaAcaoTexto(m.proxima_acao_em)} /> : null}
            <Linha rotulo="Última ação" valor={dataHora(m.ultima_acao_em)} />
            {terminal ? (
              <Linha rotulo="Encerrado em" valor={dataHora(m.encerrado_em)} />
            ) : (
              <Linha rotulo="Expira em" valor={dataHora(m.expira_em)} />
            )}
          </View>
          {!terminal && m.ultimo_ciclo_erro ? (
            <Text className="mt-2 text-xs text-destructive">Último ciclo falhou: {m.ultimo_ciclo_erro}</Text>
          ) : null}
        </CardContent>
      </Card>

      {/* ── O plano atual: em destaque, é a pergunta que a tela existe para responder ── */}
      <Card className="border-primary">
        <CardHeader>
          <CardTitle>Plano do agente</CardTitle>
          <Text className="text-xs text-muted-foreground">
            {plano
              ? `versão ${m.plano_versao} · confiança ${Math.round(plano.confianca * 100)}%`
              : 'O agente ainda não registrou um plano.'}
          </Text>
        </CardHeader>
        {plano ? (
          <CardContent className="gap-3">
            <View>
              <Text className="text-xs font-medium text-muted-foreground">Tentando agora</Text>
              <Text className="text-sm">{plano.objetivo_atual}</Text>
            </View>
            {plano.hipotese ? (
              <View>
                <Text className="text-xs font-medium text-muted-foreground">Hipótese</Text>
                <Text className="text-sm">{plano.hipotese}</Text>
              </View>
            ) : null}

            {plano.proximas_acoes.length > 0 ? (
              <View className="gap-2">
                <Text className="text-xs font-medium text-muted-foreground">Próximas ações</Text>
                {plano.proximas_acoes.map((a, i) => (
                  <View key={`${a.acao}-${i}`} className={cn('border-l-2 pl-3', i === 0 ? 'border-primary' : 'border-border')}>
                    <View className="flex-row items-start justify-between gap-2">
                      <Text className="flex-1 text-sm font-medium">{ferramentaLabel(a.acao)}</Text>
                      <Text className="text-xs text-muted-foreground">{quandoDoPlano(a.quando)}</Text>
                    </View>
                    {a.contato ? <Text className="text-xs text-muted-foreground">com {a.contato}</Text> : null}
                    {a.por_que ? <Text className="mt-0.5 text-sm">{a.por_que}</Text> : null}
                    {a.condicao ? (
                      <Text className="mt-0.5 text-xs text-muted-foreground">se {a.condicao}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            {(plano.bloqueios ?? []).length > 0 ? (
              <View className="gap-1">
                <Text className="text-xs font-medium text-muted-foreground">Bloqueios</Text>
                {(plano.bloqueios ?? []).map((b, i) => (
                  <Text key={`${i}-${b}`} className="text-sm text-amber-700">
                    • {b}
                  </Text>
                ))}
              </View>
            ) : null}
          </CardContent>
        ) : null}
      </Card>

      {/* ── Orçamento ── */}
      <Card>
        <CardHeader>
          <CardTitle>Orçamento</CardTitle>
        </CardHeader>
        <CardContent className="gap-2">
          <View className="flex-row items-baseline justify-between gap-2">
            <Text className="text-base tabular-nums">{brlCentavos(m.gasto_centavos)}</Text>
            <Text className="text-xs tabular-nums text-muted-foreground">de {brlCentavos(m.orcamento_centavos)}</Text>
          </View>
          <Barra fracao={fracaoGasto} />
          <Linha rotulo="Ações" valor={`${m.acoes_executadas} de ${m.max_acoes}`} />
        </CardContent>
      </Card>

      <View className="rounded-lg border border-border bg-muted/40 p-3">
        <Text className="text-xs text-muted-foreground">
          Pausar, assumir, encerrar, reatribuir e ajustar o orçamento é pela web: o agente fala com clientes em nome
          da casa.
        </Text>
      </View>

      <FiltroSegmentado opcoes={ABAS} valor={aba} onChange={setAba} rotulo={(label) => `Ver ${label}`} sangra />

      {aba === 'acoes' ? (
        <Card>
          <CardHeader>
            <CardTitle>Ações</CardTitle>
            <Text className="text-xs text-muted-foreground">O que o agente fez, com a intenção que ele declarou.</Text>
          </CardHeader>
          <CardContent className="gap-3">
            {acoes.isPending ? <Skeleton className="h-20 w-full" /> : null}
            {acoes.isError ? (
              <Text className="py-4 text-center text-sm text-destructive">Não foi possível carregar as ações.</Text>
            ) : null}
            {!acoes.isPending && !acoes.isError && (acoes.data ?? []).length === 0 ? (
              <Text className="py-4 text-center text-sm text-muted-foreground">O agente ainda não agiu.</Text>
            ) : null}
            {(acoes.data ?? []).map((a) => (
              <View
                key={a.id}
                className={cn(
                  'border-l-2 pl-3',
                  a.sucesso === false ? 'border-destructive' : a.sucesso === true ? 'border-primary' : 'border-border',
                )}
              >
                <View className="flex-row items-start justify-between gap-2">
                  <Text className="flex-1 text-sm font-medium">{ferramentaLabel(a.ferramenta)}</Text>
                  <Text className="text-xs text-muted-foreground">{dataHora(a.executada_em)}</Text>
                </View>
                {a.intencao ? <Text className="mt-0.5 text-sm">{a.intencao}</Text> : null}
                {a.sucesso === false ? (
                  <Text className="mt-0.5 text-xs text-destructive">Falhou{a.erro ? `: ${a.erro}` : ''}</Text>
                ) : null}
                {a.custo_centavos > 0 ? (
                  <Text className="mt-0.5 text-xs tabular-nums text-muted-foreground">{brlCentavos(a.custo_centavos)}</Text>
                ) : null}
              </View>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {aba === 'ligacoes' ? (
        <Card>
          <CardHeader>
            <CardTitle>Ligações</CardTitle>
            <Text className="text-xs text-muted-foreground">Transcrição e gravação ficam na web.</Text>
          </CardHeader>
          <CardContent className="gap-3">
            {ligacoes.isPending ? <Skeleton className="h-20 w-full" /> : null}
            {ligacoes.isError ? (
              <Text className="py-4 text-center text-sm text-destructive">Não foi possível carregar as ligações.</Text>
            ) : null}
            {!ligacoes.isPending && !ligacoes.isError && (ligacoes.data ?? []).length === 0 ? (
              <Text className="py-4 text-center text-sm text-muted-foreground">Nenhuma ligação neste mandato.</Text>
            ) : null}
            {(ligacoes.data ?? []).map((l) => (
              <View key={l.id} className="gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
                <View className="flex-row items-start justify-between gap-2">
                  <Text className="flex-1 text-sm font-medium">
                    {l.outcome ? (DESFECHO_LIGACAO_LABELS[l.outcome] ?? l.outcome) : dataHora(l.criada_em)}
                  </Text>
                  <Badge variant={varianteStatusLigacao(l.status)}>
                    <Text>{STATUS_LIGACAO_LABELS[l.status] ?? l.status}</Text>
                  </Badge>
                </View>
                <Text className="text-xs text-muted-foreground">
                  {dataHora(l.criada_em)}
                  {duracaoTexto(l.duracao_s) ? ` · ${duracaoTexto(l.duracao_s)}` : ''}
                </Text>
                {l.resumo ? <Text className="text-sm">{l.resumo}</Text> : null}
                {l.status === 'falhou' && l.erro ? <Text className="text-xs text-destructive">{l.erro}</Text> : null}
                {l.status === 'recusada' && l.motivo_recusa ? (
                  <Text className="text-xs text-muted-foreground">{l.motivo_recusa}</Text>
                ) : null}
              </View>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </ScrollView>
  )
}
