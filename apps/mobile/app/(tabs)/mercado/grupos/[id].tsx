import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo } from 'react'
import { FlatList, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { formatInteiro, registroRota, useGrupoQuery, type MembroGrupo } from '@/features/mercado'
import {
  GrupoHeader,
  GrupoMetricas,
  GrupoSkeleton,
  MembroCard,
  SpesPorAnoChart,
} from '@/features/mercado/components/grupo'

/**
 * Grupo econômico (§5.4), and the target of the deep link `/mercado/grupos/<id>`
 * that `mercado.detalhar_grupo` hands back to the AI. Expo Router ignores the
 * (tabs) group segment when matching, so the web route and the mobile route are
 * the same string.
 *
 * A FlatList, not a ScrollView: a big incorporadora has hundreds of SPEs, and the
 * header (identity, metrics, chart) rides along as ListHeaderComponent so the
 * whole screen still scrolls as one.
 */
export default function GrupoDetalheScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { colors } = useTheme()

  const { data, isPending, isError, refetch, isRefetching } = useGrupoQuery(id)

  const membros = useMemo(() => data?.membros ?? [], [data])
  const cnpjCabeca = data?.grupo.cnpj_cabeca ?? null

  // The head is a member like any other — it just gets its own block at the top,
  // so it must not be listed twice below.
  const cabeca = useMemo(
    () => (cnpjCabeca ? (membros.find((membro) => membro.cnpj === cnpjCabeca) ?? null) : null),
    [membros, cnpjCabeca],
  )
  const outros = useMemo(
    () => (cabeca ? membros.filter((membro) => membro.cnpj !== cnpjCabeca) : membros),
    [membros, cabeca, cnpjCabeca],
  )

  // Obras are per-company on the view, so the group's total is a sum over the
  // members we hold. Every other number on the metrics card comes from the server.
  const obrasAtivas = useMemo(
    () => membros.reduce((total, membro) => total + (membro.obras_ativas ?? 0), 0),
    [membros],
  )

  /** Promoted → the Company 360. Otherwise the universe sheet in the Explorador. */
  const abrirMembro = useCallback(
    (membro: MembroGrupo) => {
      const rota = registroRota(membro)
      if (rota) router.push(rota)
    },
    [router],
  )

  if (isPending) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ title: 'Grupo' }} />
        <GrupoSkeleton />
      </View>
    )
  }

  if (isError) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ title: 'Grupo' }} />
        <ErrorState
          description="Não foi possível carregar este grupo econômico. Verifique sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      </View>
    )
  }

  // Zero rows: the group doesn't exist, or RLS hid it. Same answer either way.
  if (!data) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ title: 'Grupo' }} />
        <EmptyState
          title="Grupo não encontrado"
          description="Ele pode ter sido recalculado pela última ingestão, ou seu perfil não tem acesso ao módulo Mercado."
        />
      </View>
    )
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: data.grupo.nome ?? 'Grupo econômico' }} />

      <FlatList
        data={outros}
        keyExtractor={(membro, index) => membro.cnpj ?? String(index)}
        renderItem={({ item }) => <MembroCard membro={item} onPress={abrirMembro} />}
        contentContainerClassName="gap-3 p-4 pb-12"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.mutedForeground}
          />
        }
        ListHeaderComponent={
          <View className="gap-4 pb-1">
            <GrupoHeader
              grupo={data.grupo}
              cabeca={cabeca}
              empresasTotal={data.metricas.empresas_total}
              onPressCabeca={abrirMembro}
            />
            <GrupoMetricas
              metricas={data.metricas}
              obrasAtivas={obrasAtivas}
              truncado={data.membros_truncados}
            />
            <SpesPorAnoChart
              spesPorAno={data.metricas.spes_por_ano}
              truncado={data.membros_truncados}
            />

            <View className="flex-row items-baseline justify-between gap-3 pt-2">
              <Text variant="heading">Empresas do grupo</Text>
              <Text variant="muted" className="text-xs">
                {formatInteiro(outros.length)}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Nenhuma outra empresa"
            description="Este grupo só tem a empresa cabeça — nenhuma SPE ou coligada foi identificada até agora."
          />
        }
        ListFooterComponent={
          data.membros_truncados ? (
            // Be exact about what the cap does and does not affect: the counts of
            // empresas, SPEs and capital come from the server and cover the whole
            // group; the obra total is summed over the rows in hand.
            <Text variant="muted" className="pt-2 text-center text-xs">
              Mostrando as empresas mais recentes do grupo. As obras ativas somam apenas as empresas
              carregadas aqui.
            </Text>
          ) : null
        }
      />
    </View>
  )
}
