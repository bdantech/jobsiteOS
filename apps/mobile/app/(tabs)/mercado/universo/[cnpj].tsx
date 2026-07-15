import { formatCnpj } from '@jobsiteos/core'
import { Stack, useLocalSearchParams } from 'expo-router'
import { RefreshControl, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { EmptyState, ErrorState } from '@/components/ui/states'
import {
  PromoverAcao,
  UniversoCadastro,
  UniversoDetalheSkeleton,
  UniversoGrupo,
  UniversoHeader,
  UniversoObras,
  UniversoSinais,
  UniversoSocios,
  useUniversoQuery,
} from '@/features/mercado/components/explorador'

/**
 * The universe record sheet (§5.3): everything the Receita and the CNO say about
 * a CNPJ that has NOT been promoted, plus the action that promotes it.
 *
 * Also a deep-link target — `mercado.buscar_universo` returns
 * "/mercado/universo/<cnpj>" for every row it has not seen in `empresas`. Access
 * is enforced by the root gate (module `mercado`), not by this screen.
 */
export default function UniversoDetalheScreen() {
  const { cnpj } = useLocalSearchParams<{ cnpj: string }>()
  const { colors } = useTheme()

  const { data, isPending, isError, refetch, isRefetching } = useUniversoQuery(cnpj)

  if (isPending) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ title: 'Universo' }} />
        <UniversoDetalheSkeleton />
      </View>
    )
  }

  if (isError) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ title: 'Universo' }} />
        <ErrorState
          description="Não foi possível carregar este registro do universo. Verifique sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      </View>
    )
  }

  // Zero rows: the CNPJ isn't in the filtered universe, the param is malformed, or
  // RLS hid it. Same answer to the user either way.
  if (!data) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ title: 'Universo' }} />
        <EmptyState
          title="CNPJ não encontrado no universo"
          description="Ele pode estar fora do recorte da construção, ainda não ter sido ingerido, ou seu perfil não ter acesso ao módulo."
        />
      </View>
    )
  }

  const { universo, metricas, socios, obras, grupo, grupoMembros } = data

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{ title: universo.razao_social ?? formatCnpj(universo.cnpj) }}
      />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4 pb-12"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.mutedForeground}
          />
        }
      >
        <UniversoHeader universo={universo} />

        <PromoverAcao universo={universo} />

        <UniversoCadastro universo={universo} />

        <UniversoSinais metricas={metricas} grafoSefaz={universo.grafo_sefaz} />

        {grupo ? <UniversoGrupo grupo={grupo} membros={grupoMembros} /> : null}

        <UniversoSocios socios={socios} />

        <UniversoObras obras={obras} />
      </ScrollView>
    </View>
  )
}
