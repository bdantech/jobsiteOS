import { TIPO_PRAZO_LABELS, type TipoPrazo } from '@jobsiteos/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { Alert, FlatList, Pressable, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { buscarAgenda, concluirPrazo, juridicoKeys } from '../api'

/**
 * A agenda de prazos no celular (08 §8).
 *
 * Os VENCIDOS primeiro e em vermelho: a janela começa sete dias atrás justamente para
 * eles aparecerem. Um prazo de ontem que ninguém concluiu é o que mais precisa ser
 * visto — escondê-lo por já ter passado transforma um problema em silêncio.
 */
export function PrazosMobile() {
  const router = useRouter()
  const qc = useQueryClient()
  const { colors } = useTheme()

  const agenda = useQuery({ queryKey: juridicoKeys.agenda(), queryFn: buscarAgenda })

  const concluir = useMutation({
    mutationFn: concluirPrazo,
    onSuccess: () => void qc.invalidateQueries({ queryKey: juridicoKeys.agenda() }),
    onError: (e: Error) => Alert.alert('Não foi possível concluir', e.message),
  })

  if (agenda.isPending) {
    return (
      <View className="gap-3 p-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </View>
    )
  }

  if (agenda.isError) {
    return <ErrorState title="Não foi possível carregar a agenda" onRetry={() => void agenda.refetch()} />
  }

  const agora = Date.now()

  return (
    <FlatList
      data={agenda.data ?? []}
      keyExtractor={(item) => item.id ?? ''}
      contentContainerClassName="gap-3 p-4 pb-8"
      refreshControl={
        <RefreshControl
          refreshing={agenda.isRefetching}
          onRefresh={() => void agenda.refetch()}
          tintColor={colors.primary}
        />
      }
      ListEmptyComponent={
        <EmptyState
          title="Nenhum prazo em aberto"
          description="Prazos e audiências são cadastrados na tela de cada processo."
        />
      }
      renderItem={({ item }) => {
        const vencido = item.inicio_em ? Date.parse(item.inicio_em) < agora : false
        return (
          <View className="rounded-xl border border-border bg-card p-4">
            <Pressable onPress={() => router.push(`/juridico/${encodeURIComponent(item.numero_cnj ?? '')}`)}>
              <View className="flex-row flex-wrap items-center gap-2">
                <Badge variant={vencido ? 'destructive' : 'outline'}>
                  <Text>{TIPO_PRAZO_LABELS[item.tipo as TipoPrazo] ?? item.tipo}</Text>
                </Badge>
                {vencido ? (
                  <Badge variant="destructive">
                    <Text>vencido</Text>
                  </Badge>
                ) : null}
              </View>
              <Text className="mt-1 text-sm font-medium">{item.titulo}</Text>
              <Text className="mt-0.5 text-xs text-muted-foreground">
                {item.inicio_em
                  ? new Date(item.inicio_em).toLocaleString('pt-BR', {
                      weekday: 'short',
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '—'}
                {item.devedor_nome ? ` · ${item.devedor_nome}` : ''}
              </Text>
              <Text className="text-xs text-muted-foreground">{item.numero_cnj}</Text>
            </Pressable>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onPress={() => item.id && concluir.mutate(item.id)}
            >
              <Text>Concluir</Text>
            </Button>
          </View>
        )
      }}
    />
  )
}
