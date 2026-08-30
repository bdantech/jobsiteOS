import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ActivityIndicator, Alert, FlatList, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { EmptyState, ErrorState } from '@/components/ui/states'
import {
  STATUS_CAMPANHA_LABELS,
  TIPO_CAMPANHA_LABELS,
  type StatusCampanha,
  type TipoCampanha,
} from '@jobsiteos/core'
import {
  aprovarCampanha,
  buscarCampanhas,
  campanhasKeys,
  pausarCampanha,
  retomarCampanha,
} from '@/features/campanhas'

/**
 * Campanhas no celular: ler o placar e apertar os três botões que importam
 * (05B §8). O construtor é webOnly — montar público e ler um dry-run de mil
 * linhas não se faz com o polegar.
 *
 * Aprovar está aqui, e cancelar NÃO. Aprovar é a decisão que costuma travar
 * esperando alguém que está fora do escritório; cancelar é irreversível para o
 * que já não vai sair, e uma decisão irreversível merece uma tela grande e uma
 * confirmação que não seja um `Alert` de sistema.
 */
export default function CampanhasScreen() {
  const { colors } = useTheme()
  const qc = useQueryClient()
  const [agindo, setAgindo] = useState<string | null>(null)

  const { data, isPending, isError, refetch, isRefetching } = useQuery({
    queryKey: campanhasKeys.lista(),
    queryFn: buscarCampanhas,
  })

  const acao = useMutation({
    mutationFn: async (args: { id: string; tipo: 'aprovar' | 'pausar' | 'retomar' }) => {
      if (args.tipo === 'aprovar') return aprovarCampanha(args.id)
      if (args.tipo === 'pausar') return pausarCampanha(args.id)
      return retomarCampanha(args.id)
    },
    onSettled: () => {
      setAgindo(null)
      void qc.invalidateQueries({ queryKey: campanhasKeys.all })
    },
    onError: (e) => Alert.alert('Não foi possível', e instanceof Error ? e.message : 'Erro.'),
  })

  function agir(id: string, tipo: 'aprovar' | 'pausar' | 'retomar') {
    setAgindo(id)
    acao.mutate({ id, tipo })
  }

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    )
  }
  if (isError) return <ErrorState onRetry={() => void refetch()} />
  if ((data ?? []).length === 0) {
    return (
      <EmptyState
        title="Nenhuma campanha"
        description="Campanhas são criadas no computador — aqui você acompanha e controla."
      />
    )
  }

  return (
    <FlatList
      data={data}
      keyExtractor={(c) => c.id as string}
      contentContainerClassName="gap-2 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      renderItem={({ item }) => {
        const enviadas = item.enviadas ?? 0
        const respondidas = item.respondidas ?? 0
        const ocupado = agindo === item.id
        return (
          <Card className="gap-2 p-4">
            <Text className="font-medium">{item.nome}</Text>
            <View className="flex-row flex-wrap items-center gap-1.5">
              <Badge>
                <Text className="text-[10px]">
                  {STATUS_CAMPANHA_LABELS[item.status as StatusCampanha] ?? item.status}
                </Text>
              </Badge>
              <Badge variant="outline">
                <Text className="text-[10px]">
                  {TIPO_CAMPANHA_LABELS[item.tipo as TipoCampanha] ?? item.tipo}
                </Text>
              </Badge>
              <Badge variant="outline">
                <Text className="text-[10px]">{item.canal === 'email' ? 'E-mail' : 'WhatsApp'}</Text>
              </Badge>
            </View>

            <Text variant="muted" className="text-[12px]">
              {enviadas} enviada(s) de {item.total ?? 0} · {respondidas} resposta(s)
              {enviadas > 0 ? ` · ${((respondidas / enviadas) * 100).toFixed(1)}%` : ''}
            </Text>

            {item.status === 'aguardando_aprovacao' ? (
              <Button onPress={() => agir(item.id as string, 'aprovar')} disabled={ocupado}>
                <Text>Aprovar e agendar</Text>
              </Button>
            ) : null}
            {item.status === 'agendada' || item.status === 'executando' ? (
              <Button
                variant="outline"
                onPress={() => agir(item.id as string, 'pausar')}
                disabled={ocupado}
              >
                <Text>Pausar</Text>
              </Button>
            ) : null}
            {item.status === 'pausada' ? (
              <Button onPress={() => agir(item.id as string, 'retomar')} disabled={ocupado}>
                <Text>Retomar</Text>
              </Button>
            ) : null}
          </Card>
        )
      }}
    />
  )
}
