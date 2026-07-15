import { CAMADAS, parseArvore, type Camada } from '@jobsiteos/core'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { ListFilter, Search } from 'lucide-react-native'
import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import {
  CamadaFiltro,
  ExploradorCard,
  ExploradorListSkeleton,
  FiltroAtivo,
  SegmentosSheet,
  UfFiltro,
  formatTotal,
  useDebouncedValue,
  useExploradorQuery,
  type ExploradorFiltros,
  type ExploradorListItem,
  type FiltroComposto,
} from '@/features/mercado/components/explorador'

/**
 * The Explorador (§5.3), query-only on mobile.
 *
 * `mercado_explorador` has ~2M rows, so nothing here is ever unbounded: the list
 * pages with `.range()` and the count is an estimate. Composite filters are not
 * BUILT here (the visual rule builder is web-only) — they are CONSUMED: from a
 * saved segmento, or from a route param, which is how the Mapa deep-links into a
 * pre-filtered list.
 */

/** Route params are attacker-influenced in the general case (a push payload can
 *  carry a url). Validate them against the vocabulary instead of trusting them. */
function camadaInicial(raw: string | undefined): Camada | undefined {
  return CAMADAS.find((camada) => camada === raw)
}

function ufInicial(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const uf = raw.toUpperCase()
  return /^[A-Z]{2}$/.test(uf) ? uf : undefined
}

function filtroInicial(raw: string | undefined): FiltroComposto | undefined {
  if (!raw) return undefined
  try {
    // parseArvore is the gate: a tree that fails it must never reach a compiler.
    return { arvore: parseArvore(JSON.parse(raw)), origem: { tipo: 'mapa' } }
  } catch {
    // A malformed deep link is not an error state — show the unfiltered universe
    // rather than a broken screen.
    return undefined
  }
}

export default function ExploradorScreen() {
  const router = useRouter()
  const { colors } = useTheme()

  const params = useLocalSearchParams<{ camada?: string; uf?: string; filtro?: string }>()

  const [termo, setTermo] = useState('')
  // Seeded from the route, then owned by the screen: the Mapa pushes a NEW
  // instance of this screen for each drill-down, so seeding is enough.
  const [camada, setCamada] = useState<Camada | undefined>(() => camadaInicial(params.camada))
  const [uf, setUf] = useState<string | undefined>(() => ufInicial(params.uf))
  const [filtro, setFiltro] = useState<FiltroComposto | undefined>(() =>
    filtroInicial(params.filtro),
  )
  const [segmentosAbertos, setSegmentosAbertos] = useState(false)

  // Only the term is debounced: a chip tap is a deliberate, single action.
  const termoDebounced = useDebouncedValue(termo)

  const filtros = useMemo<ExploradorFiltros>(
    () => ({ termo: termoDebounced, camada, uf, filtro }),
    [termoDebounced, camada, uf, filtro],
  )

  const {
    data,
    isPending,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useExploradorQuery(filtros)

  const abrir = useCallback(
    (row: ExploradorListItem) => {
      // Promoted → the Company 360, where it has timeline, notas and eventos.
      // Still in staging → the lightweight universe sheet.
      if (row.empresa_id) router.push(`/empresas/${row.empresa_id}`)
      else router.push(`/mercado/universo/${row.cnpj}`)
    },
    [router],
  )

  const renderItem = useCallback(
    ({ item }: { item: ExploradorListItem }) => <ExploradorCard row={item} onPress={abrir} />,
    [abrir],
  )

  const filtrando =
    termoDebounced.trim().length > 0 ||
    camada !== undefined ||
    uf !== undefined ||
    filtro !== undefined

  const limpar = useCallback(() => {
    setTermo('')
    setCamada(undefined)
    setUf(undefined)
    setFiltro(undefined)
  }, [])

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: 'Explorador' }} />

      {/* The search box and the chips stay mounted OUTSIDE the FlatList: inside
          ListHeaderComponent the TextInput remounts on every re-render and loses
          focus, which makes typing drop characters. */}
      <View className="gap-3 pb-3 pt-3">
        <View className="justify-center px-4">
          <View className="absolute left-7 z-10">
            <Search size={18} color={colors.mutedForeground} />
          </View>
          <Input
            value={termo}
            onChangeText={setTermo}
            placeholder="Buscar por razão social, fantasia ou CNPJ"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Buscar no universo"
            className="pl-10"
          />
        </View>

        <CamadaFiltro value={camada} onChange={setCamada} />
        <UfFiltro value={uf} onChange={setUf} />

        {filtro ? <FiltroAtivo filtro={filtro} onClear={() => setFiltro(undefined)} /> : null}

        <View className="flex-row items-center justify-between gap-3 px-4">
          <Text variant="muted" className="flex-1 text-xs" numberOfLines={1}>
            {isError ? '' : formatTotal(data?.total ?? null)}
          </Text>

          <Button
            variant="outline"
            size="sm"
            onPress={() => setSegmentosAbertos(true)}
            accessibilityLabel="Aplicar um segmento salvo"
          >
            <ListFilter size={16} color={colors.foreground} />
            <Text>Segmentos</Text>
          </Button>
        </View>
      </View>

      {isPending ? (
        <ExploradorListSkeleton />
      ) : isError ? (
        <ErrorState
          description="Não foi possível carregar o universo. Verifique sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      ) : (
        <FlatList
          data={data.rows}
          keyExtractor={(item) => item.cnpj}
          renderItem={renderItem}
          contentContainerClassName="gap-3 px-4 pb-10"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && !isFetchingNextPage}
              onRefresh={() => void refetch()}
              tintColor={colors.mutedForeground}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
          }}
          ListEmptyComponent={
            <EmptyState
              title="Nenhuma empresa encontrada"
              description={
                filtrando
                  ? 'Nenhuma empresa do universo corresponde a estes filtros. Tente outro termo ou limpe os filtros.'
                  : 'O universo ainda está vazio. Ele é carregado pela ingestão da Receita Federal.'
              }
              actionLabel={filtrando ? 'Limpar filtros' : undefined}
              onAction={filtrando ? limpar : undefined}
            />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View className="py-6">
                <ActivityIndicator color={colors.mutedForeground} />
              </View>
            ) : null
          }
        />
      )}

      <SegmentosSheet
        open={segmentosAbertos}
        onOpenChange={setSegmentosAbertos}
        ativo={filtro}
        onSelect={setFiltro}
      />
    </View>
  )
}
