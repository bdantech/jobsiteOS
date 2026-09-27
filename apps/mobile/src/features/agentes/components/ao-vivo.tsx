import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { KanbanSquare, OctagonAlert } from 'lucide-react-native'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { AbaixoDoCabecalho, useRecuoDoCabecalho } from '@/components/shell/cabecalho-de-vidro'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import {
  agentesKeys,
  buscarAgentesAoVivo,
  buscarFeedAoVivo,
  buscarKillSwitch,
  type AcaoDoFeed,
  type AgenteAoVivo,
} from '../api'
import {
  brlCentavos,
  desde,
  estadoAgenteLabel,
  ferramentaLabel,
  nomeDoAgente,
  tipoAgenteLabel,
  varianteEstadoAgente,
} from '../format'
import { useAcoesAoVivo } from '../realtime'

/**
 * O Ao vivo no celular (09 §11.1 Mobile).
 *
 * Duas perguntas, nesta ordem: "os agentes estão de pé?" (os cartões) e "o que eles
 * estão fazendo?" (o feed). O cartão vem primeiro porque um disjuntor aberto é o único
 * motivo para alguém abrir esta tela fora da mesa — e é o push de disjuntor que traz
 * a pessoa até aqui.
 *
 * Só leitura. Reabrir disjuntor, pausar e configurar é pela web: a configuração é
 * `webOnly` na spec, e reabrir um disjuntor pede o motivo por escrito.
 */

/**
 * Os cartões mudam de estado com o RELÓGIO (operando vira ocioso 15 min depois da última
 * ação) e não só com linha nova — o Realtime não avisaria disso. O feed já vem pelo
 * Realtime; a volta periódica dele é a rede de segurança para uma assinatura que caiu.
 */
const INTERVALO_CARTOES_MS = 60_000
const INTERVALO_FEED_MS = 30_000

function CartaoAgente({ agente }: { agente: AgenteAoVivo }) {
  const alarme = agente.estado === 'disjuntor_aberto'

  return (
    <View className={cn('rounded-xl border bg-card p-4', alarme ? 'border-destructive' : 'border-border')}>
      <View className="flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1">
          <Text className="font-medium" numberOfLines={1}>
            {nomeDoAgente(agente)}
          </Text>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {tipoAgenteLabel(agente.tipo)}
            {nomeDoAgente(agente) !== agente.nome ? ` · ${agente.nome}` : ''}
          </Text>
        </View>
        <Badge variant={varianteEstadoAgente(agente.estado)}>
          <Text>{estadoAgenteLabel(agente.estado)}</Text>
        </Badge>
      </View>

      {alarme ? (
        <Text className="mt-2 text-xs text-destructive">
          {agente.disjuntorMotivo ? `${agente.disjuntorMotivo} · ` : ''}reabrir é pela web, com o motivo.
        </Text>
      ) : null}

      <View className="mt-2 flex-row items-center justify-between gap-2">
        <Text className="text-xs text-muted-foreground">
          {agente.mandatosAtivos} mandato{agente.mandatosAtivos === 1 ? '' : 's'} ativo
          {agente.mandatosAtivos === 1 ? '' : 's'}
        </Text>
        <Text className="text-xs tabular-nums text-muted-foreground">
          {brlCentavos(agente.gastoHojeCentavos)} hoje
        </Text>
      </View>
    </View>
  )
}

function LinhaDoFeed({ acao, onPress }: { acao: AcaoDoFeed; onPress: () => void }) {
  const falhou = acao.sucesso === false

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="rounded-xl border border-border bg-card px-4 py-3 active:opacity-70"
    >
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 text-sm font-medium" numberOfLines={1}>
          {nomeDoAgente(acao.agente)} · {ferramentaLabel(acao.ferramenta)}
        </Text>
        <Text className="text-xs tabular-nums text-muted-foreground">{desde(acao.executada_em)}</Text>
      </View>
      <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={1}>
        {acao.empresa?.razao_social ?? '—'}
      </Text>
      {acao.intencao ? (
        <Text className="mt-1 text-sm" numberOfLines={3}>
          {acao.intencao}
        </Text>
      ) : null}
      {falhou ? (
        <Text className="mt-1 text-xs text-destructive" numberOfLines={2}>
          Falhou{acao.erro ? `: ${acao.erro}` : ''}
        </Text>
      ) : null}
    </Pressable>
  )
}

export function AgentesAoVivo() {
  const router = useRouter()
  const { colors } = useTheme()
  const recuo = useRecuoDoCabecalho()
  const qc = useQueryClient()

  const cartoes = useQuery({
    queryKey: agentesKeys.cards(),
    queryFn: buscarAgentesAoVivo,
    refetchInterval: INTERVALO_CARTOES_MS,
  })
  const feed = useQuery({ queryKey: agentesKeys.feed(), queryFn: buscarFeedAoVivo, refetchInterval: INTERVALO_FEED_MS })
  const killSwitch = useQuery({
    queryKey: agentesKeys.killSwitch(),
    queryFn: buscarKillSwitch,
    refetchInterval: INTERVALO_CARTOES_MS,
  })

  // Ação nova: o feed e os cartões (ela muda "operando" e o gasto do dia).
  useAcoesAoVivo(() => {
    void qc.invalidateQueries({ queryKey: agentesKeys.feed() })
    void qc.invalidateQueries({ queryKey: agentesKeys.cards() })
  })

  if (cartoes.isPending || feed.isPending) {
    return (
      <AbaixoDoCabecalho>
        <View className="gap-3 p-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </View>
      </AbaixoDoCabecalho>
    )
  }

  if (cartoes.isError || feed.isError) {
    return (
      <AbaixoDoCabecalho>
        <ErrorState
          title="Não foi possível carregar os agentes"
          onRetry={() => {
            void cartoes.refetch()
            void feed.refetch()
          }}
        />
      </AbaixoDoCabecalho>
    )
  }

  const agentes = cartoes.data
  const atualizando = cartoes.isRefetching || feed.isRefetching || killSwitch.isRefetching

  return (
    <FlatList
      data={feed.data}
      keyExtractor={(item) => item.id}
      contentContainerClassName="gap-3 px-4 pb-28"
      contentContainerStyle={{ paddingTop: recuo + 16 }}
      refreshControl={
        <RefreshControl
          refreshing={atualizando}
          onRefresh={() => {
            void cartoes.refetch()
            void feed.refetch()
            void killSwitch.refetch()
          }}
          tintColor={colors.primary}
        />
      }
      ListHeaderComponent={
        <View className="gap-3">
          {/* O kill switch vem antes de tudo: com ele ligado, um feed parado é o esperado. */}
          {killSwitch.data ? (
            <View className="flex-row items-start gap-3 rounded-xl border border-destructive bg-destructive/10 px-4 py-3">
              <OctagonAlert size={18} color={colors.destructive} />
              <View className="flex-1">
                <Text className="text-sm font-semibold text-destructive">Kill switch ligado</Text>
                <Text className="text-xs text-muted-foreground">
                  Nenhum agente age e nada automático sai enquanto ele estiver ligado. Desligar é pela web.
                </Text>
              </View>
            </View>
          ) : null}

          <Pressable
            onPress={() => router.push('/agentes/mandatos')}
            accessibilityRole="button"
            className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 active:opacity-70"
          >
            <KanbanSquare size={16} color={colors.foreground} />
            <Text className="flex-1 text-sm font-medium">Mandatos</Text>
            <Text className="text-xs text-muted-foreground">Ver</Text>
          </Pressable>

          <Text className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agentes</Text>
          {agentes.length === 0 ? (
            <Text className="text-sm text-muted-foreground">
              Nenhum agente no seu alcance. Quem não é gestor vê os agentes de que é o closer.
            </Text>
          ) : (
            agentes.map((a) => <CartaoAgente key={a.id} agente={a} />)
          )}

          <Text className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agora</Text>
        </View>
      }
      ListEmptyComponent={
        <EmptyState title="Nenhuma ação ainda" description="As ações dos agentes aparecem aqui assim que acontecem." />
      }
      renderItem={({ item }) => (
        <LinhaDoFeed acao={item} onPress={() => router.push(`/agentes/${item.mandato_id}`)} />
      )}
    />
  )
}
