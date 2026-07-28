import { formatCnpj } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { Clock, Sparkles } from 'lucide-react-native'
import { useCallback } from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import {
  ListaSkeleton,
  formatarData,
  formatarMoeda,
  useSacadosProspectarQuery,
  useSacadosSemCnaeQuery,
  type SacadoProspectar,
} from '@/features/antecipacao'

/**
 * Sacados a prospectar — construtoras que recebem NF e não estão na plataforma.
 *
 * O recorte é por CNAE (divisões 41/42/43): sem ele a lista vira "todo CNPJ que
 * já apareceu como destinatário". A regra anterior filtrava por "fornecedor que
 * já antecipou" e não funcionava — `clientes_onepay` só tem construtoras, então
 * casar o CNPJ do FORNECEDOR contra ela era quase sempre falso. Aquele sinal
 * virou uma linha DENTRO do card, não um portão na entrada.
 *
 * Tocar abre o sacado com as notas que ele recebeu.
 */
export default function ProspectarScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { data, isPending, isError, refetch, isRefetching } = useSacadosProspectarQuery()
  const { data: pendentes = 0 } = useSacadosSemCnaeQuery()

  const renderItem = useCallback(
    ({ item }: { item: SacadoProspectar }) => (
      <Pressable
        onPress={() => item.sacado_cnpj && router.push(`/antecipacao/sacados/${item.sacado_cnpj}`)}
        accessibilityRole="button"
        accessibilityLabel={`Ver as notas de ${item.sacado_nome ?? 'construtora'}`}
        className="gap-2 rounded-xl border border-border bg-card p-3 active:opacity-70"
      >
        <View className="flex-row items-start justify-between gap-2">
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="font-medium">
              {item.sacado_nome ?? '—'}
            </Text>
            <Text variant="muted" className="text-xs tabular-nums">
              {item.sacado_cnpj ? formatCnpj(item.sacado_cnpj) : '—'}
              {item.sacado_municipio || item.sacado_uf
                ? ` · ${[item.sacado_municipio, item.sacado_uf].filter(Boolean).join(' / ')}`
                : ''}
            </Text>
          </View>
          <Text className="font-semibold tabular-nums">{formatarMoeda(item.valor_agregado)}</Text>
        </View>

        <View className="flex-row flex-wrap items-center gap-1.5">
          <Badge variant="outline">
            <Text className="text-[10px]">CNAE {item.sacado_cnae_principal ?? '—'}</Text>
          </Badge>
          <Text variant="muted" className="text-xs">
            {item.notas} nota{(item.notas ?? 0) > 1 ? 's' : ''} · {item.fornecedores} fornecedor
            {(item.fornecedores ?? 0) > 1 ? 'es' : ''}
          </Text>
        </View>

        {/* O antigo portão virou sinal de temperatura. */}
        {(item.notas_de_quem_ja_antecipou ?? 0) > 0 ? (
          <View className="flex-row items-center gap-1.5">
            <Sparkles size={12} color={colors.mutedForeground} />
            <Text className="text-xs text-emerald-700 dark:text-emerald-300">
              {item.notas_de_quem_ja_antecipou} nota
              {(item.notas_de_quem_ja_antecipou ?? 0) > 1 ? 's' : ''} de quem já antecipa
            </Text>
          </View>
        ) : null}

        <Text variant="muted" className="text-[11px]">
          Última nota em {formatarData(item.ultima_nota_em)}
        </Text>
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
      /* A ausência precisa ser explicada: o recorte por CNAE cria uma janela entre
         a nota chegar e o lookup cadastral responder. */
      ListHeaderComponent={
        pendentes > 0 ? (
          <View className="mb-1 flex-row items-start gap-2 rounded-lg border border-border bg-muted/50 p-3">
            <Clock size={14} color={colors.mutedForeground} />
            <Text variant="muted" className="flex-1 text-xs">
              {pendentes} sacado{pendentes > 1 ? 's' : ''} ainda sem CNAE — só entram na lista depois
              que o lookup cadastral responder, e apenas os de construção.
            </Text>
          </View>
        ) : null
      }
      ListEmptyComponent={
        <EmptyState
          title="Nenhuma construtora nesta condição"
          description="A lista se enche quando o sync trouxer notas cujo destinatário tenha CNAE de construção (41, 42 ou 43) e não esteja na plataforma."
        />
      }
    />
  )
}
