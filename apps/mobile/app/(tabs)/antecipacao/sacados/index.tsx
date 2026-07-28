import { formatCnpj } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { useCallback } from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import {
  ListaSkeleton,
  creditoVariant,
  formatarMoeda,
  labelCredito,
  useSacadosQuery,
  type SacadoFunil,
} from '@/features/antecipacao'
import { cn } from '@/lib/utils'

/**
 * Visão por sacado no mobile — LEITURA (§9). A curadoria (mover estágio, suprimir)
 * é do funil; aqui a pergunta é uma só: cabe?
 *
 * A barra é relativa ao maior dos dois valores, para que o EXCEDENTE seja visível.
 * Uma barra que trava em 100% quando a demanda passa o limite esconde exatamente a
 * informação que importa.
 */
function Contencao({ demanda, disponivel }: { demanda: number; disponivel: number }) {
  const escala = Math.max(demanda, disponivel, 1)
  const estoura = demanda > disponivel

  return (
    <View className="gap-1">
      <View className="h-2 overflow-hidden rounded-full bg-muted">
        <View
          className="h-full rounded-full bg-emerald-500/40"
          style={{ width: `${(disponivel / escala) * 100}%` }}
        />
        <View
          className={cn('absolute top-[25%] h-1 rounded-full', estoura ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${(demanda / escala) * 100}%` }}
        />
      </View>
      <Text variant="muted" className="text-[11px] tabular-nums">
        pipeline {formatarMoeda(demanda)} · limite {formatarMoeda(disponivel)}
      </Text>
    </View>
  )
}

export default function SacadosScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { data, isPending, isError, refetch, isRefetching } = useSacadosQuery()

  const renderItem = useCallback(
    ({ item }: { item: SacadoFunil }) => {
      const demanda = Number(item.demanda_pipeline ?? 0)
      const disponivel = Number(item.available_limit ?? 0)
      const excedente = Math.max(0, demanda - disponivel)

      return (
        <Pressable
          disabled={!item.sacado_empresa_id}
          onPress={() =>
            item.sacado_empresa_id && router.push(`/empresas/${item.sacado_empresa_id}`)
          }
          accessibilityRole="button"
          accessibilityLabel={`Abrir ${item.sacado_nome ?? 'sacado'}`}
          className="gap-2 rounded-xl border border-border bg-card p-3 active:opacity-70"
        >
          <View className="flex-row items-start justify-between gap-2">
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="font-medium">
                {item.sacado_nome ?? '—'}
              </Text>
              <Text variant="muted" className="text-xs tabular-nums">
                {item.sacado_cnpj ? formatCnpj(item.sacado_cnpj) : '—'}
              </Text>
            </View>
            <Badge variant={creditoVariant(item.credito_status)}>
              <Text className="text-[10px]">{labelCredito(item.credito_status)}</Text>
            </Badge>
          </View>

          <Contencao demanda={demanda} disponivel={disponivel} />

          <View className="flex-row items-center justify-between">
            <Text variant="muted" className="text-xs tabular-nums">
              {item.notas_em_faixa} nota(s) · {item.fornecedores} fornecedor(es)
            </Text>
            {excedente > 0 ? (
              <Text className="text-xs font-semibold tabular-nums text-destructive">
                excede {formatarMoeda(excedente)}
              </Text>
            ) : (
              <Text variant="muted" className="text-xs">
                cabe no limite
              </Text>
            )}
          </View>
        </Pressable>
      )
    },
    [router],
  )

  if (isPending) return <ListaSkeleton />

  if (isError) {
    return (
      <ErrorState
        description="Não foi possível carregar os sacados. Verifique sua conexão e tente novamente."
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
          title="Nenhuma nota em faixa"
          description="Sem notas classificadas não há demanda de pipeline para comparar com o limite dos sacados."
        />
      }
    />
  )
}
