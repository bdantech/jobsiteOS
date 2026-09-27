import { formatCnpj } from '@jobsiteos/core'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { AbaixoDoCabecalho, useRecuoDoCabecalho } from '@/components/shell/cabecalho-de-vidro'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { buscarRelogio, cobrancaKeys } from '../api'
import { brl, corDoPrazo, dataBr, marcoLabel, prazoTexto, sinistroEstagioLabel } from '../format'

/**
 * O relógio da apólice no celular (07 §6.3): os marcos que vencem em até 30 dias,
 * do mais apertado para o mais folgado.
 *
 * Título FORA de cobrança aparece também — e é de propósito. A parada de cobertura de
 * D+60 corre sobre o vencimento original de todo título coberto em aberto, com ou sem
 * alguém cuidando dele; um título sem cobrança perto do D+90 é exatamente o que ninguém
 * está olhando. O selo "sem cobrança" diz isso na linha.
 */
export function PrazosApoliceMobile() {
  const router = useRouter()
  const { colors } = useTheme()
  const recuo = useRecuoDoCabecalho()

  const relogio = useQuery({ queryKey: cobrancaKeys.relogio(), queryFn: buscarRelogio })

  if (relogio.isPending) {
    return (
      <AbaixoDoCabecalho>
        <View className="gap-3 p-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </View>
      </AbaixoDoCabecalho>
    )
  }

  if (relogio.isError) {
    return (
      <AbaixoDoCabecalho>
        <ErrorState title="Não foi possível carregar os prazos" onRetry={() => void relogio.refetch()} />
      </AbaixoDoCabecalho>
    )
  }

  return (
    <FlatList
      data={relogio.data ?? []}
      keyExtractor={(item) => item.id ?? `${item.titulo_id}`}
      contentContainerClassName="gap-3 p-4 pb-28"
      contentContainerStyle={{ paddingTop: recuo + 16 }}
      refreshControl={
        <RefreshControl
          refreshing={relogio.isRefetching}
          onRefresh={() => void relogio.refetch()}
          tintColor={colors.primary}
        />
      }
      ListEmptyComponent={
        <EmptyState
          title="Nenhum prazo nos próximos 30 dias"
          description="O relógio roda todo dia às 6h sobre o vencimento original de cada título coberto."
        />
      }
      renderItem={({ item }) => {
        const conteudo = (
          <>
            <View className="flex-row items-start justify-between gap-2">
              <Text className="flex-1 font-medium" numberOfLines={1}>
                {item.sacado_nome ?? formatCnpj(item.sacado_cnpj ?? '')}
              </Text>
              <Text className={cn('text-sm tabular-nums', corDoPrazo(item.dias_restantes))}>
                {prazoTexto(item.dias_restantes)}
              </Text>
            </View>
            <Text className="mt-0.5 text-xs text-muted-foreground">
              {marcoLabel(item.proximo_marco)} · {dataBr(item.proximo_marco_em)}
            </Text>
            <Text className="mt-0.5 text-xs text-muted-foreground">
              Título {item.numero ?? '—'} · {brl(item.valor_face)} · venceu {dataBr(item.vencimento_original)} (D+
              {item.dias_desde_vencimento ?? '—'})
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {item.cobranca_codigo ? (
                <Badge variant="secondary">
                  <Text>{item.cobranca_codigo}</Text>
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <Text>sem cobrança</Text>
                </Badge>
              )}
              {item.causa === 'insolvencia' ? (
                <Badge variant="outline">
                  <Text>insolvência</Text>
                </Badge>
              ) : null}
              {item.sinistro_codigo ? (
                <Badge variant="outline">
                  <Text>
                    {item.sinistro_codigo} · {sinistroEstagioLabel(item.sinistro_estagio)}
                  </Text>
                </Badge>
              ) : null}
            </View>
          </>
        )
        return item.cobranca_id ? (
          <Pressable
            onPress={() => router.push(`/cobranca/${item.cobranca_id}`)}
            className="rounded-xl border border-border bg-card p-4 active:opacity-70"
          >
            {conteudo}
          </Pressable>
        ) : (
          <View className="rounded-xl border border-border bg-card p-4">{conteudo}</View>
        )
      }}
    />
  )
}
