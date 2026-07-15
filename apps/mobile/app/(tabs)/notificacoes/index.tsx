import { useRouter } from 'expo-router'
import { CheckCheck } from 'lucide-react-native'
import { useCallback } from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import {
  useMarcarLida,
  useMarcarTodasLidas,
  useNotificacoes,
  useNotificacoesRealtime,
  type Notificacao,
} from '@/features/notificacoes'
import { useSession } from '@/lib/auth'
import { resolveNotificationHref } from '@/lib/linking'
import { cn } from '@/lib/utils'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
})

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
})

/** "agora", "há 5 min", "há 3 h", "ontem 14:20", "07/07/25". */
function formatarQuando(iso: string): string {
  const data = new Date(iso)
  const minutos = Math.floor((Date.now() - data.getTime()) / 60_000)

  if (minutos < 1) return 'agora'
  if (minutos < 60) return `há ${minutos} min`

  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `há ${horas} h`
  if (horas < 48) return `ontem ${timeFormatter.format(data)}`

  return dateFormatter.format(data)
}

function NotificacaoSkeleton() {
  return (
    <View className="gap-2 rounded-xl border border-border bg-card p-4">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-16" />
    </View>
  )
}

export default function NotificacoesScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { grantedModuleIds } = useSession()

  // Live: an INSERT from notify() or the empresa_eventos trigger, or an UPDATE
  // from this user's other device, refreshes the list under them.
  useNotificacoesRealtime()

  const { data, isPending, isError, refetch, isRefetching } = useNotificacoes()
  const marcarLida = useMarcarLida()
  const marcarTodasLidas = useMarcarTodasLidas()

  const naoLidas = data?.filter((n) => !n.lida).length ?? 0

  const abrir = useCallback(
    (notificacao: Notificacao): void => {
      if (!notificacao.lida) marcarLida.mutate(notificacao.id)

      // `url` holds a WEB route ("/empresas/<uuid>"); the mobile file tree mirrors
      // it inside (tabs), and the registry decides whether this user may follow it
      // here at all (ungranted or webOnly → landing route).
      router.push(resolveNotificationHref(notificacao.url, grantedModuleIds))
    },
    [marcarLida, router, grantedModuleIds],
  )

  if (isPending) {
    return (
      <View className="flex-1 gap-3 bg-background p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <NotificacaoSkeleton key={i} />
        ))}
      </View>
    )
  }

  if (isError) {
    return (
      <View className="flex-1 bg-background">
        <ErrorState
          description="Não foi possível carregar suas notificações. Verifique sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      </View>
    )
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      data={data}
      keyExtractor={(item) => item.id}
      // flex-grow only when empty, so <EmptyState className="flex-1"> can centre
      // itself in the viewport instead of hugging the top.
      contentContainerClassName={cn('gap-3 p-4 pb-10', data.length === 0 && 'flex-grow')}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={colors.mutedForeground}
          colors={[colors.primary]}
        />
      }
      ListHeaderComponent={
        naoLidas > 0 ? (
          <View className="flex-row items-center justify-between pb-1">
            <Text variant="muted">
              {naoLidas} não {naoLidas === 1 ? 'lida' : 'lidas'}
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Marcar todas como lidas"
              disabled={marcarTodasLidas.isPending}
              onPress={() => marcarTodasLidas.mutate()}
              hitSlop={8}
              className="flex-row items-center gap-1.5 rounded-md px-2 py-1 active:bg-muted"
            >
              <CheckCheck size={14} color={colors.primary} />
              <Text className="text-sm font-medium text-primary">Marcar todas como lidas</Text>
            </Pressable>
          </View>
        ) : null
      }
      ListEmptyComponent={
        <EmptyState
          className="flex-1"
          title="Nenhuma notificação"
          description="Você será avisado aqui quando algo acontecer nas empresas que você acompanha."
        />
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.titulo}
          onPress={() => abrir(item)}
          className="active:opacity-80"
        >
          <Card className={cn('gap-1 p-4', !item.lida && 'border-primary/40 bg-primary/5')}>
            <View className="flex-row items-start gap-2">
              {item.lida ? null : (
                <View className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
              )}
              <Text variant="label" className="flex-1">
                {item.titulo}
              </Text>
            </View>

            {item.corpo ? (
              <Text variant="muted" className={item.lida ? undefined : 'pl-4'}>
                {item.corpo}
              </Text>
            ) : null}

            <Text variant="muted" className={cn('text-xs', !item.lida && 'pl-4')}>
              {formatarQuando(item.criado_em)}
            </Text>
          </Card>
        </Pressable>
      )}
    />
  )
}
