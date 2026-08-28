import {
  BENCHMARK_FASES_PADRAO,
  COLUNAS_JURIDICO,
  FASE_LABELS,
  SITUACAO_INTERNA_LABELS,
  type BenchmarkFases,
  type Fase,
  type SituacaoInterna,
} from '@jobsiteos/core'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import * as React from 'react'
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { buscarCarteira, buscarConfig, juridicoKeys, type LinhaCarteira } from '../api'

/**
 * A carteira judicial no celular (08 §8).
 *
 * LISTA com filtro por situação, e não kanban: um kanban de seis colunas num celular é
 * uma coluna visível e cinco escondidas. A lista com filtro entrega a mesma informação
 * sem fingir que a tela é larga — a mesma decisão da esteira do Crédito.
 *
 * O que não some aqui é o BADGE DE LENTIDÃO. Quem abre o Jurídico no celular está fora
 * do escritório e tem tempo para uma coisa só; a lentidão é o que diz qual é ela.
 */

function moeda(v: number | string | null): string {
  if (v === null || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export function ProcessosLista() {
  const router = useRouter()
  const { colors } = useTheme()
  const [filtro, setFiltro] = React.useState<SituacaoInterna | null>(null)

  const carteira = useQuery({ queryKey: juridicoKeys.carteira(), queryFn: buscarCarteira })
  const config = useQuery({ queryKey: juridicoKeys.config(), queryFn: buscarConfig })

  const benchmark = ((config.data?.benchmark_fases as BenchmarkFases | undefined) ??
    BENCHMARK_FASES_PADRAO) as BenchmarkFases

  const linhas = (carteira.data ?? []).filter((l) => !filtro || l.situacao_interna === filtro)

  if (carteira.isPending) {
    return (
      <View className="gap-3 p-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </View>
    )
  }

  if (carteira.isError) {
    return <ErrorState title="Não foi possível carregar os processos" onRetry={() => void carteira.refetch()} />
  }

  return (
    <View className="flex-1">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-4 py-3"
      >
        <Pressable onPress={() => setFiltro(null)}>
          <Badge variant={filtro === null ? 'default' : 'outline'}>
            <Text>Todos</Text>
          </Badge>
        </Pressable>
        {COLUNAS_JURIDICO.map((s) => (
          <Pressable key={s} onPress={() => setFiltro(s)}>
            <Badge variant={filtro === s ? 'default' : 'outline'}>
              <Text>{SITUACAO_INTERNA_LABELS[s]}</Text>
            </Badge>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={linhas}
        keyExtractor={(item) => item.numero_cnj ?? String(item.data_distribuicao)}
        contentContainerClassName="gap-3 px-4 pb-8"
        refreshControl={
          <RefreshControl
            refreshing={carteira.isRefetching}
            onRefresh={() => void carteira.refetch()}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title="Nenhum processo"
            description={
              filtro
                ? 'Nenhum processo nesta situação.'
                : 'A importação roda pelos nossos CNPJs, na web, em Configurações do Jurídico.'
            }
          />
        }
        renderItem={({ item }) => {
          const limite = item.fase_atual ? (benchmark[item.fase_atual as Fase] ?? null) : null
          const lento = limite !== null && (item.dias_na_fase ?? 0) > limite
          return (
            <Pressable
              onPress={() => router.push(`/juridico/${encodeURIComponent(item.numero_cnj ?? '')}`)}
              className="rounded-xl border border-border bg-card p-4"
            >
              <View className="flex-row items-start justify-between gap-2">
                <Text className="flex-1 font-medium" numberOfLines={1}>
                  {item.devedor_nome ?? item.numero_cnj}
                </Text>
                <Text className="text-sm tabular-nums">
                  {moeda(item.valor_atualizado ?? item.valor_causa)}
                </Text>
              </View>

              <Text className="mt-0.5 text-xs text-muted-foreground">{item.numero_cnj}</Text>

              <View className="mt-2 flex-row flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  <Text>{SITUACAO_INTERNA_LABELS[item.situacao_interna as SituacaoInterna] ?? '—'}</Text>
                </Badge>
                {item.fase_atual ? (
                  <Badge variant="outline">
                    <Text>{FASE_LABELS[item.fase_atual as Fase] ?? item.fase_atual}</Text>
                  </Badge>
                ) : null}
                {lento ? (
                  <Badge variant="destructive">
                    <Text>{item.dias_na_fase}d na fase</Text>
                  </Badge>
                ) : null}
                {/*
                 * "Sem cálculo" é acionável e não é zero: significa que ninguém gerou
                 * a memória, e o valor atualizado da lista está mostrando a causa.
                 */}
                {item.valor_atualizado === null ? (
                  <Badge variant="outline">
                    <Text>sem cálculo</Text>
                  </Badge>
                ) : null}
              </View>

              {item.dias_sem_movimentacao !== null ? (
                <Text className="mt-2 text-xs text-muted-foreground">
                  Última movimentação há {item.dias_sem_movimentacao} dia(s)
                </Text>
              ) : null}
            </Pressable>
          )
        }}
      />
    </View>
  )
}
