import { ESTAGIO_FUNIL_LABELS, type EstagioFunil } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { Building2, Search, Sparkles } from 'lucide-react-native'
import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import {
  FiltrosFunil,
  FunilSkeleton,
  NotaCard,
  formatarMoeda,
  useFunilQuery,
  useMinimoOperavelQuery,
  type FornecedorFunil,
  type NotaFunil,
} from '@/features/antecipacao'
import { useDebouncedValue } from '@/features/empresas'

/**
 * O FUNIL É A TELA PRINCIPAL DO MÓDULO no mobile (§9) — não um dashboard.
 *
 * Quem abre Antecipação no celular está na rua e quer trabalhar notas: lista
 * ordenada por receita esperada, filtro rápido, pull-to-refresh, busca. Os números
 * agregados (métricas por faixa) são análise de escritório e ficam no web.
 *
 * A ordem visual e a ordem da consulta são a mesma — receita esperada decrescente —
 * porque a primeira coisa que a lista precisa comunicar é "comece por aqui".
 */
export default function FunilScreen() {
  const router = useRouter()
  const { colors } = useTheme()

  const [estagio, setEstagio] = useState<string>('a_prospectar')
  const [faixa, setFaixa] = useState<string | undefined>()
  const [tipagem, setTipagem] = useState<string | undefined>()
  const [termo, setTermo] = useState('')

  // Só o termo é debounced: tocar num chip é uma ação deliberada e única.
  const termoDebounced = useDebouncedValue(termo)

  const filtros = useMemo(
    () => ({ estagio, faixa, tipagem, termo: termoDebounced || undefined }),
    [estagio, faixa, tipagem, termoDebounced],
  )

  const { data: minimoOperavel = 7 } = useMinimoOperavelQuery()
  const {
    data,
    isPending,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useFunilQuery(filtros)

  // O `select` do hook já achata as páginas e faz o merge dos mapas de fornecedor.
  const notas = data?.notas ?? []
  const fornecedores: Map<string, FornecedorFunil> = data?.fornecedores ?? new Map()
  const total = data?.total ?? 0
  const valorPagina = notas.reduce((s, n) => s + Number(n.valor ?? 0), 0)

  const renderItem = useCallback(
    ({ item }: { item: NotaFunil }) => (
      <NotaCard
        nota={item}
        fornecedor={item.fornecedor_cnpj ? fornecedores.get(item.fornecedor_cnpj) : undefined}
        minimoOperavel={minimoOperavel}
      />
    ),
    [fornecedores, minimoOperavel],
  )

  const filtrando = Boolean(termoDebounced || faixa || tipagem)

  // A busca e os filtros ficam FORA da FlatList: dentro de ListHeaderComponent o
  // TextInput remonta a cada re-render e perde o foco, o que faz a digitação comer
  // caracteres.
  const header = (
    <View className="gap-3 pb-3 pt-3">
      <View className="justify-center px-4">
        <View className="absolute left-7 z-10">
          <Search size={18} color={colors.mutedForeground} />
        </View>
        <Input
          value={termo}
          onChangeText={setTermo}
          placeholder="Buscar fornecedor, sacado ou nota"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Buscar no funil"
          className="pl-10"
        />
      </View>

      <FiltrosFunil
        estagio={estagio}
        onEstagio={setEstagio}
        faixa={faixa}
        onFaixa={setFaixa}
        tipagem={tipagem}
        onTipagem={setTipagem}
      />

      <View className="flex-row items-center justify-between px-4">
        <Text variant="muted" className="text-xs tabular-nums">
          {isPending ? '…' : `${total.toLocaleString('pt-BR')} notas`}
          {notas.length > 0 ? ` · ${formatarMoeda(valorPagina)} carregados` : ''}
        </Text>
        <View className="flex-row gap-1">
          <Button
            variant="ghost"
            size="sm"
            onPress={() => router.push('/antecipacao/sacados')}
            accessibilityLabel="Ver capacidade por sacado"
          >
            <Building2 size={16} color={colors.mutedForeground} />
            <Text className="text-xs">Sacados</Text>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => router.push('/antecipacao/prospectar')}
            accessibilityLabel="Ver sacados a prospectar"
          >
            <Sparkles size={16} color={colors.mutedForeground} />
            <Text className="text-xs">Prospectar</Text>
          </Button>
        </View>
      </View>
    </View>
  )

  return (
    <View className="flex-1 bg-background">
      {header}

      {isPending ? (
        <FunilSkeleton />
      ) : isError ? (
        <ErrorState
          description="Não foi possível carregar o funil. Verifique sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      ) : (
        <FlatList
          data={notas}
          keyExtractor={(item) => item.access_key as string}
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
              title="Nenhuma nota aqui"
              description={
                filtrando
                  ? 'Nada com estes filtros. Tente limpar a faixa ou a tipagem.'
                  : `Nada em ${ESTAGIO_FUNIL_LABELS[estagio as EstagioFunil] ?? estagio}. As notas chegam pelo sync, de 4 em 4 horas.`
              }
              actionLabel={filtrando ? 'Limpar filtros' : undefined}
              onAction={
                filtrando
                  ? () => {
                      setTermo('')
                      setFaixa(undefined)
                      setTipagem(undefined)
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
