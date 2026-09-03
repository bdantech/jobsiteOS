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
import {
  ESTAGIO_SDR_LABELS,
  proximoEstagioSdr,
  rotuloOrigemLead,
  useLeads,
  useMover,
} from '@/features/comercial'

/**
 * Funil de reuniões no celular: lista, não kanban.
 *
 * Cada card tem UM botão — o próximo passo. As saídas que exigem motivo (sem fit) não
 * estão aqui de propósito: escolher um motivo numa lista de seis, com o polegar, é como
 * o motivo vira sempre "Outro" — e o motivo é o dado mais valioso deste funil.
 */
export default function FunilSdrScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const [movendo, setMovendo] = useState<string | null>(null)
  const { data, isPending, isError, refetch, isRefetching } = useLeads()
  const { moverLead, marcarComFit } = useMover()

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
        title="Nenhum lead vivo"
        description="A distribuição roda toda segunda de manhã."
      />
    )
  }

  return (
    <FlatList
      data={data}
      keyExtractor={(l) => l.id}
      contentContainerClassName="gap-2 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      renderItem={({ item }) => {
        const proximo = proximoEstagioSdr(item.estagio)
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
                <Text className="text-[10px]">{ESTAGIO_SDR_LABELS[item.estagio as never] ?? item.estagio}</Text>
              </Badge>
              {item.empresas?.uf ? (
                <Badge variant="outline"><Text className="text-[10px]">{item.empresas.uf}</Text></Badge>
              ) : null}
              {/* A porta pela qual o lead entrou: muda a primeira frase da ligação. */}
              <Badge variant="outline">
                <Text className="text-[10px]">{rotuloOrigemLead(item.origem)}</Text>
              </Badge>
              {item.fit === true ? (
                <Badge variant="outline"><Text className="text-[10px]">Com fit</Text></Badge>
              ) : null}
              {item.reuniao_em ? (
                <Text variant="muted" className="text-[11px]">
                  {new Date(item.reuniao_em).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              ) : null}
            </View>
            {proximo ? (
              <Button
                variant="outline"
                disabled={movendo === item.id}
                onPress={async () => {
                  setMovendo(item.id)
                  try {
                    await moverLead(item.id, proximo)
                  } finally {
                    setMovendo(null)
                  }
                }}
              >
                <Text>{ESTAGIO_SDR_LABELS[proximo]}</Text>
                <ChevronRight size={14} color={colors.foreground} />
              </Button>
            ) : (
              <Text variant="muted" className="text-[11px]">
                O próximo passo daqui é agendar, que pede data e closer — faça na web.
              </Text>
            )}
            {item.estagio !== 'a_contatar' && item.fit !== true ? (
              <Button
                variant="ghost"
                disabled={movendo === item.id}
                onPress={async () => {
                  setMovendo(item.id)
                  try {
                    await marcarComFit(item.id)
                  } finally {
                    setMovendo(null)
                  }
                }}
              >
                <Text>Marcar com fit</Text>
              </Button>
            ) : null}
          </Card>
        )
      }}
    />
  )
}
