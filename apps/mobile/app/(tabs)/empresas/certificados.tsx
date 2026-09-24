import { useCallback } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'

import { AbaixoDoCabecalho, useRecuoDoCabecalho } from '@/components/shell/cabecalho-de-vidro'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Skeleton } from '@/components/ui/skeleton'
import { ResumoCertificados, useCertificadosQuery } from '@/features/certificados'

/**
 * Certificados digitais no celular (04b §5). Empilha sobre a lista de Empresas, como
 * a Company 360 — é uma consulta do mesmo módulo, não uma aba nova.
 */
export default function CertificadosScreen() {
  const { data, isPending, isError, error, refetch, isRefetching } = useCertificadosQuery()
  const recuo = useRecuoDoCabecalho()

  const onRefresh = useCallback(() => {
    void refetch()
  }, [refetch])

  if (isPending) {
    return (
      <AbaixoDoCabecalho>
        <View className="gap-3 p-4">
          <View className="flex-row gap-2">
            <Skeleton className="h-20 flex-1" />
            <Skeleton className="h-20 flex-1" />
            <Skeleton className="h-20 flex-1" />
          </View>
          <Skeleton className="h-72 w-full" />
        </View>
      </AbaixoDoCabecalho>
    )
  }

  if (isError) {
    return (
      <AbaixoDoCabecalho>
        <ErrorState
          title="Erro ao carregar certificados"
          description={error instanceof Error ? error.message : 'Tente novamente.'}
          onRetry={onRefresh}
        />
      </AbaixoDoCabecalho>
    )
  }

  if (data.indicadores.clientesTotal === 0) {
    return (
      <AbaixoDoCabecalho>
        <EmptyState
          title="Nenhum cliente na base"
          description="O painel mostra construtoras clientes Onepay. Rode o sync no worker."
        />
      </AbaixoDoCabecalho>
    )
  }

  return (
    <ScrollView
      contentContainerClassName="p-4 pb-28"
      contentContainerStyle={{ paddingTop: recuo + 16 }}
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
