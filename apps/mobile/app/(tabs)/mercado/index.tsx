import type { Camada } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { useCallback } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { EmptyState, ErrorState } from '@/components/ui/states'
import {
  CamadaCard,
  MapaSkeleton,
  PiramideChart,
  formatInteiro,
  useResumoPiramideQuery,
} from '@/features/mercado'

/**
 * Mapa do Mercado (§5.2) — read-only on mobile. The rule builder (Pirâmide), the
 * list importer and the ingestion admin are webOnly; this screen answers "who
 * exists, who fits, who can we win", and hands off to the Explorador.
 *
 * Every number on it is an EXACT count over `mercado_explorador`, under RLS.
 * Averages and sums (idade média, capital médio, m² em execução) are absent on
 * purpose: PostgREST aggregate functions are disabled on this project and the
 * foundation ships no summary RPC, so the only way to show a mean here would be
 * to average a page of rows and present it as if it were the market. It isn't.
 */
export default function MapaDoMercadoScreen() {
  const router = useRouter()
  const { colors } = useTheme()

  const { data: resumo, isPending, isError, refetch, isRefetching } = useResumoPiramideQuery()

  const abrirExplorador = useCallback(
    (camada?: Camada) => {
      router.push(camada ? `/mercado/explorador?camada=${camada}` : '/mercado/explorador')
    },
    [router],
  )

  if (isPending) return <MapaSkeleton />

  if (isError) {
    return (
      <View className="flex-1 bg-background">
        <ErrorState
          description="Não foi possível carregar o mapa do mercado. Verifique sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      </View>
    )
  }

  const vazio = resumo.total === 0

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName="gap-6 p-4 pb-12"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.mutedForeground}
          />
        }
      >
        {vazio ? (
          // The honest state, and the one a reviewer sees today: the Receita dump
          // has not been ingested, so there is no universe to draw a pyramid over.
          // No alarm, no retry button pretending this is a failure — it is simply
          // work the worker has not done yet.
          <EmptyState
            title="O universo ainda não foi ingerido"
            description="Nenhum CNPJ foi carregado da Receita Federal até agora. Assim que a primeira ingestão terminar, a pirâmide e os indicadores de cada camada aparecem aqui."
            actionLabel="Abrir o Explorador"
            onAction={() => abrirExplorador()}
          />
        ) : (
          <>
            <View className="gap-1">
              <Text variant="muted" className="text-xs uppercase tracking-wide">
                Universo mapeado
              </Text>
              <Text variant="title">{formatInteiro(resumo.total)}</Text>
              <Text variant="muted" className="text-xs">
                Empresas na Receita e nas listas importadas. Toque em uma camada para abri-la no
                Explorador.
              </Text>
            </View>

            <PiramideChart camadas={resumo.camadas} onSelect={abrirExplorador} />

            <View className="gap-3">
              {resumo.camadas.map((camada) => (
                <CamadaCard key={camada.camada} resumo={camada} onPress={abrirExplorador} />
              ))}
            </View>

            <Button variant="outline" onPress={() => abrirExplorador()}>
              <Text>Abrir o Explorador</Text>
            </Button>
          </>
        )}
      </ScrollView>
    </View>
  )
}
