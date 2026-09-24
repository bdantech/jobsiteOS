import { ESTAGIO_LABELS, type Estagio } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { Search, ShieldCheck } from 'lucide-react-native'
import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  View,
  type TextInput,
} from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import {
  CabecalhoRetratil,
  useCabecalhoRetratil,
} from '@/components/shell/cabecalho-retratil'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { EmptyState, ErrorState } from '@/components/ui/states'
import {
  EmpresaCard,
  EmpresasListSkeleton,
  EstagioFiltro,
  useDebouncedValue,
  useEmpresasQuery,
  type EmpresaListItem,
} from '@/features/empresas'

export default function EmpresasScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const buscaRef = useRef<TextInput>(null)
  const {
    deslocamento,
    recolhido,
    aoRolar,
    listaRef,
    voltarAoTopo,
    alturaCabecalho,
    setAlturaCabecalho,
  } = useCabecalhoRetratil<EmpresaListItem>()

  const [termo, setTermo] = useState('')
  const [estagio, setEstagio] = useState<Estagio | undefined>(undefined)

  // Only the term is debounced: a chip tap is a deliberate, single action.
  const termoDebounced = useDebouncedValue(termo)

  const {
    data: empresas,
    isPending,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useEmpresasQuery({ termo: termoDebounced, estagio })

  const abrirEmpresa = useCallback(
    (id: string) => {
      router.push(`/empresas/${id}`)
    },
    [router],
  )

  const renderItem = useCallback(
    ({ item }: { item: EmpresaListItem }) => <EmpresaCard empresa={item} onPress={abrirEmpresa} />,
    [abrirEmpresa],
  )

  const buscando = termoDebounced.trim().length > 0 || estagio !== undefined

  // A busca e o estágio moram no cabeçalho, FORA da lista: dentro de
  // ListHeaderComponent o TextInput remonta a cada render e perde o foco, o que
  // faz a digitação comer caracteres.
  const cabecalho = (
    <CabecalhoRetratil
      titulo="Empresas"
      resumo={`${estagio ? ESTAGIO_LABELS[estagio] : 'Todos os estágios'}${
        termoDebounced.trim() ? ` · “${termoDebounced.trim()}”` : ''
      }`}
      deslocamento={deslocamento}
      recolhido={recolhido}
      onExpandir={voltarAoTopo}
      onAltura={setAlturaCabecalho}
      aoReabrir={() => setTimeout(() => buscaRef.current?.focus(), 240)}
      busca={
        <Input
          ref={buscaRef}
          value={termo}
          onChangeText={setTermo}
          placeholder="Buscar por razão social, fantasia ou CNPJ"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Buscar empresas"
          icone={<Search size={20} color={colors.mutedForeground} />}
          containerClassName="gap-0"
          className="border-0"
        />
      }
      chips={<EstagioFiltro value={estagio} onChange={setEstagio} />}
    />
  )

  // Certificados (04b §5): consulta do mesmo módulo, empilha sobre a lista. É um
  // atalho, não um recorte, e por isso rola com os cards.
  const painelDaLista = (
    <View className="pb-3 pt-3">
      <Pressable
        onPress={() => router.push('/empresas/certificados')}
        accessibilityRole="button"
        accessibilityLabel="Abrir certificados digitais"
        className="flex-row items-center gap-2 rounded-md border border-border px-3 py-2 active:opacity-70"
      >
        <ShieldCheck size={16} color={colors.mutedForeground} />
        <Text className="text-sm">Certificados digitais</Text>
      </Pressable>
    </View>
  )

  // O cabeçalho é absoluto: quem reserva o espaço dele é o `paddingTop` da lista.
  const recuoDoCabecalho = { paddingTop: alturaCabecalho }

  return (
    <View className="flex-1 bg-background">
      {isPending ? (
        <View style={recuoDoCabecalho} className="flex-1">
          <EmpresasListSkeleton />
        </View>
      ) : isError ? (
        <View style={recuoDoCabecalho} className="flex-1">
          <ErrorState
            description="Não foi possível carregar as empresas. Verifique sua conexão e tente novamente."
            onRetry={() => void refetch()}
          />
        </View>
      ) : (
        <Animated.FlatList
          ref={listaRef}
          data={empresas}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={painelDaLista}
          onScroll={aoRolar}
          scrollEventThrottle={16}
          contentContainerStyle={recuoDoCabecalho}
          contentContainerClassName="gap-3 px-4 pb-28"
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
                buscando
                  ? 'Nenhuma empresa corresponde a esta busca. Tente outro termo ou limpe os filtros.'
                  : 'Nenhuma empresa cadastrada ainda.'
              }
              actionLabel={buscando ? 'Limpar filtros' : undefined}
              onAction={
                buscando
                  ? () => {
                      setTermo('')
                      setEstagio(undefined)
                    }
                  : undefined
              }
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

      {/* Depois da lista: em RN o irmão posterior pinta por cima. */}
      {cabecalho}
    </View>
  )
}
