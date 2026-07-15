import type { Estagio } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { Search } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Input } from '@/components/ui/input'
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

  // The search box and chips stay mounted OUTSIDE the list: inside
  // ListHeaderComponent the TextInput remounts on re-render and loses focus,
  // which makes typing drop characters.
  const header = (
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
          accessibilityLabel="Buscar empresas"
          className="pl-10"
        />
      </View>

      <EstagioFiltro value={estagio} onChange={setEstagio} />
    </View>
  )

  return (
    <View className="flex-1 bg-background">
      {header}

      {isPending ? (
        <EmpresasListSkeleton />
      ) : isError ? (
        <ErrorState
          description="Não foi possível carregar as empresas. Verifique sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      ) : (
        <FlatList
          data={empresas}
          keyExtractor={(item) => item.id}
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
    </View>
  )
}
