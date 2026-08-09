import { ESTAGIO_VENDA_LABELS, type EstagioVenda } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import { useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { proximoEstagioVenda, useMover, useVendas } from '@/features/comercial'

/**
 * Funil do closer no celular. Mesma regra do funil de SDR: um botão, o próximo passo.
 *
 * Perder não está aqui — exige motivo, e motivo escolhido às pressas vira "Outro". Um
 * card em análise de crédito também não anda: quem move é a decisão da seguradora.
 */
export default function FunilVendasScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const [movendo, setMovendo] = useState<string | null>(null)
  const { data, isPending, isError, refetch, isRefetching } = useVendas()
  const { moverVenda } = useMover()

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    )
  }
  if (isError) return <ErrorState onRetry={() => void refetch()} />
  if ((data ?? []).length === 0) {
    return <EmptyState title="Nenhuma venda em aberto" description="Reuniões agendadas por SDRs aparecem aqui." />
  }

  return (
    <FlatList
      data={data}
      keyExtractor={(v) => v.id}
      contentContainerClassName="gap-2 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      renderItem={({ item }) => {
        const proximo = proximoEstagioVenda(item.estagio)
        return (
          <Card className="gap-2 p-4">
            <Pressable
              onPress={() => item.empresas && router.push(`/empresas/${item.empresas.id}`)}
              accessibilityRole="button"
            >
              <Text className="font-medium">{item.empresas?.razao_social ?? 'Empresa'}</Text>
            </Pressable>
            <View className="flex-row flex-wrap items-center gap-1.5">
              <Badge variant="outline">
                <Text className="text-[10px]">
                  {ESTAGIO_VENDA_LABELS[item.estagio as EstagioVenda] ?? item.estagio}
                </Text>
              </Badge>
              {item.empresas?.uf ? (
                <Badge variant="outline"><Text className="text-[10px]">{item.empresas.uf}</Text></Badge>
              ) : null}
            </View>
            {item.estagio === 'em_analise_credito' ? (
              <Text variant="muted" className="text-[11px]">
                Aguardando a seguradora. O card anda sozinho quando ela decidir.
              </Text>
            ) : proximo ? (
              <Button
                variant="outline"
                disabled={movendo === item.id}
                onPress={async () => {
                  setMovendo(item.id)
                  try {
                    await moverVenda(item.id, proximo)
                  } finally {
                    setMovendo(null)
                  }
                }}
              >
                <Text>{ESTAGIO_VENDA_LABELS[proximo]}</Text>
                <ChevronRight size={14} color={colors.foreground} />
              </Button>
            ) : null}
          </Card>
        )
      }}
    />
  )
}
