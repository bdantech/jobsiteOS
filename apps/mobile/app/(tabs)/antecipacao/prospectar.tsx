import { formatCnpj } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { Sparkles } from 'lucide-react-native'
import { useCallback } from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import {
  ListaSkeleton,
  formatarData,
  formatarMoeda,
  useSacadosProspectarQuery,
  type SacadoProspectar,
} from '@/features/antecipacao'

/**
 * Sacados a prospectar — o flywheel inverso, em LEITURA no mobile (§9).
 *
 * Cada linha é uma construtora fora da plataforma que já recebe notas de
 * fornecedores que operam com a gente. É o lead mais quente da base, e aparece de
 * graça como subproduto do sync de NFs.
 *
 * Promover para `empresas` é ação de escritório (web): envolve decidir que aquela
 * construtora entra no CRM. Aqui o vendedor descobre a oportunidade e, se a empresa
 * já existe, abre a ficha.
 */
export default function ProspectarScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { data, isPending, isError, refetch, isRefetching } = useSacadosProspectarQuery()

  const renderItem = useCallback(
    ({ item }: { item: SacadoProspectar }) => (
      <Pressable
        disabled={!item.sacado_empresa_id}
        onPress={() => item.sacado_empresa_id && router.push(`/empresas/${item.sacado_empresa_id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Ver ${item.sacado_nome ?? 'construtora'}`}
        className="gap-2 rounded-xl border border-border bg-card p-3 active:opacity-70"
      >
        <View className="flex-row items-start justify-between gap-2">
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="font-medium">
              {item.sacado_nome ?? '—'}
            </Text>
            <Text variant="muted" className="text-xs tabular-nums">
              {item.sacado_cnpj ? formatCnpj(item.sacado_cnpj) : '—'}
              {item.sacado_uf ? ` · ${item.sacado_uf}` : ''}
            </Text>
          </View>
          <Text className="font-semibold tabular-nums">{formatarMoeda(item.valor_agregado)}</Text>
        </View>

        <View className="flex-row items-center gap-1.5">
          <Sparkles size={12} color={colors.mutedForeground} />
          <Text variant="muted" className="text-xs">
            {item.fornecedores_operando} fornecedor(es) que já antecipam · {item.notas} nota(s) ·
            última em {formatarData(item.ultima_nota_em)}
          </Text>
        </View>
      </Pressable>
    ),
    [router, colors.mutedForeground],
  )

  if (isPending) return <ListaSkeleton />

  if (isError) {
    return (
      <ErrorState
        description="Não foi possível carregar a lista. Verifique sua conexão e tente novamente."
        onRetry={() => void refetch()}
      />
    )
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      data={data}
      keyExtractor={(item) => item.sacado_cnpj as string}
      renderItem={renderItem}
      contentContainerClassName="gap-3 p-4 pb-10"
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={colors.mutedForeground}
        />
      }
      ListEmptyComponent={
        <EmptyState
          title="Nenhum sacado nesta condição"
          description="Aparece quando um fornecedor que já antecipou emite nota contra uma construtora fora da plataforma."
        />
      }
    />
  )
}
