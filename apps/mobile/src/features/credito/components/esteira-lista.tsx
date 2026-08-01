import {
  COLUNAS_ESTEIRA,
  ESTAGIO_ANALISE_LABELS,
  formatCnpj,
  type EstagioAnalise,
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
import { supabase } from '@/lib/supabase'

/**
 * A esteira no celular (04d §4.4): lista por estágio, com filtro de estágio no topo.
 *
 * Não há kanban aqui, e não é limitação de tela: um kanban de nove colunas num celular é
 * uma coluna visível e oito escondidas. A lista com filtro entrega a mesma informação sem
 * fingir que a tela é larga.
 *
 * Também não há envio à seguradora. O envio pode ser cobrado e precisa de conferência —
 * é uma decisão de mesa, e o botão vive na web.
 */

interface ItemEsteira {
  id: string
  cnpj: string
  estagio: string
  limite_solicitado: number | null
  limite_aprovado: number | null
  origem: string
  atualizada_em: string
  razao_social: string | null
}

async function buscarEsteira(): Promise<ItemEsteira[]> {
  const { data, error } = await supabase
    .from('analises_credito')
    .select('id, cnpj, estagio, limite_solicitado, limite_aprovado, origem, atualizada_em, empresas(razao_social)')
    .order('atualizada_em', { ascending: false })
    .limit(300)
  if (error) throw new Error(error.message)
  type Raw = Omit<ItemEsteira, 'razao_social'> & { empresas: { razao_social: string | null } | null }
  return ((data ?? []) as unknown as Raw[]).map((a) => ({ ...a, razao_social: a.empresas?.razao_social ?? null }))
}

function moeda(v: number | null): string {
  if (v === null || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export function EsteiraLista() {
  const router = useRouter()
  const { colors } = useTheme()
  const [filtro, setFiltro] = React.useState<EstagioAnalise | null>(null)

  const { data, isPending, isError, refetch, isRefetching } = useQuery({
    queryKey: ['credito', 'esteira'],
    queryFn: buscarEsteira,
  })

  const contagem = React.useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of data ?? []) m[a.estagio] = (m[a.estagio] ?? 0) + 1
    return m
  }, [data])

  const itens = (data ?? []).filter((a) => filtro === null || a.estagio === filtro)

  if (isPending) {
    return (
      <View className="gap-2 p-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </View>
    )
  }

  if (isError) return <ErrorState onRetry={() => void refetch()} />

  return (
    <View className="flex-1">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-4 py-3"
      >
        <Pressable onPress={() => setFiltro(null)} accessibilityRole="button">
          <Badge variant={filtro === null ? 'default' : 'outline'}>
            <Text className="text-[11px]">Todas ({(data ?? []).length})</Text>
          </Badge>
        </Pressable>
        {COLUNAS_ESTEIRA.filter((e) => (contagem[e] ?? 0) > 0).map((e) => (
          <Pressable key={e} onPress={() => setFiltro(e)} accessibilityRole="button">
            <Badge variant={filtro === e ? 'default' : 'outline'}>
              <Text className="text-[11px]">
                {ESTAGIO_ANALISE_LABELS[e]} ({contagem[e]})
              </Text>
            </Badge>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={itens}
        keyExtractor={(a) => a.id}
        contentContainerClassName="gap-2 px-4 pb-8"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.mutedForeground} />
        }
        ListEmptyComponent={
          <EmptyState
            title="Nenhuma análise"
            description="As solicitações nascem na ficha de um sacado, ou vêm do histórico da apólice."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/credito/${item.id}` as never)}
            accessibilityRole="button"
            accessibilityLabel={`Abrir a análise de ${item.razao_social ?? formatCnpj(item.cnpj)}`}
            className="gap-2 rounded-xl border border-border bg-card p-3 active:opacity-70"
          >
            <View className="flex-row items-start justify-between gap-2">
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="font-medium">
                  {item.razao_social ?? formatCnpj(item.cnpj)}
                </Text>
                <Text variant="muted" className="text-xs tabular-nums">
                  {formatCnpj(item.cnpj)}
                </Text>
              </View>
              <Text className="font-semibold tabular-nums">
                {moeda(item.limite_aprovado ?? item.limite_solicitado)}
              </Text>
            </View>
            <View className="flex-row flex-wrap items-center gap-1.5">
              <Badge variant="outline">
                <Text className="text-[10px]">
                  {ESTAGIO_ANALISE_LABELS[item.estagio as EstagioAnalise] ?? item.estagio}
                </Text>
              </Badge>
              {item.origem === 'atradius_backfill' ? (
                <Badge variant="outline">
                  <Text className="text-[10px]">da apólice</Text>
                </Badge>
              ) : null}
              {item.limite_aprovado !== null ? (
                <Text variant="muted" className="text-[11px]">
                  aprovado
                </Text>
              ) : null}
            </View>
          </Pressable>
        )}
      />
    </View>
  )
}
