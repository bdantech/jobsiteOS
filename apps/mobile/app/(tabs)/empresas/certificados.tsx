import { useCallback } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'

import { EmptyState, ErrorState } from '@/components/ui/states'
import { Skeleton } from '@/components/ui/skeleton'
import { ResumoCertificados, useCertificadosQuery } from '@/features/certificados'

/**
 * Certificados digitais no celular (04b §5). Empilha sobre a lista de Empresas, como
 * a Company 360 — é uma consulta do mesmo módulo, não uma aba nova.
 */
export default function CertificadosScreen() {
  const { data, isPending, isError, error, refetch, isRefetching } = useCertificadosQuery()

  const onRefresh = useCallback(() => {
    void refetch()
  }, [refetch])

  if (isPending) {
    return (
      <View className="gap-3 p-4">
        <View className="flex-row gap-2">
          <Skeleton className="h-20 flex-1" />
          <Skeleton className="h-20 flex-1" />
          <Skeleton className="h-20 flex-1" />
        </View>
        <Skeleton className="h-72 w-full" />
      </View>
    )
  }

  if (isError) {
    return (
      <ErrorState
        title="Erro ao carregar certificados"
        description={error instanceof Error ? error.message : 'Tente novamente.'}
        onRetry={onRefresh}
      />
    )
  }

  if (data.indicadores.clientesTotal === 0) {
    return (
      <EmptyState
        title="Nenhum cliente na base"
        description="O painel mostra construtoras clientes Onepay. Rode o sync no worker."
      />
    )
  }

  return (
    <ScrollView
      contentContainerClassName="p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />}
    >
      <ResumoCertificados
        indicadores={data.indicadores}
        atencao={data.atencao}
        sincronizadoEm={data.sincronizadoEm}
      />
    </ScrollView>
  )
}
