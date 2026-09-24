import AsyncStorage from '@react-native-async-storage/async-storage'
import { BellRing, X } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

import { usePushDispositivo } from '../hooks'

const CHAVE_DISPENSADO = 'jobsiteos:convite-push-dispensado'

/**
 * O CONVITE PARA LIGAR AS NOTIFICAÇÕES (0262).
 *
 * A auditoria de 24/09 achou zero aparelhos registrados: todo aviso com push virava
 * só sino, e quem não abre o app não sabia de nada — nem da reunião esperando o
 * aceite dele. A chave existia, escondida em Configurações. O convite a traz para a
 * frente, uma vez: "Agora não" o dispensa neste aparelho, e ele não volta a cobrar.
 *
 * Some sozinho quando o push fica ativo, e não aparece onde push não existe
 * (simulador, projeto sem EAS).
 */
export function ConviteNotificacoes() {
  const { colors } = useTheme()
  const push = usePushDispositivo()
  const [dispensado, setDispensado] = useState<boolean | null>(null)

  useEffect(() => {
    AsyncStorage.getItem(CHAVE_DISPENSADO)
      .then((v) => setDispensado(v === '1'))
      .catch(() => setDispensado(false))
  }, [])

  const ambiente = push.ambiente.data
  if (!push.pronto || dispensado !== false || !ambiente?.disponivel || push.ativo) return null

  const bloqueada = !ambiente.concedida && !ambiente.podePerguntar

  function dispensar() {
    setDispensado(true)
    void AsyncStorage.setItem(CHAVE_DISPENSADO, '1').catch(() => undefined)
  }

  return (
    <View className="gap-3 rounded-lg border border-border bg-card p-4">
      <View className="flex-row items-start gap-3">
        <View className="size-10 items-center justify-center rounded-md bg-muted">
          <BellRing size={20} color={colors.primary} />
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-[15px] font-semibold text-foreground">Ative as notificações</Text>
          <Text className="text-[13px] leading-[19px] text-muted-foreground">
            Reunião esperando seu aceite, cliente que respondeu, nota que vence: os avisos chegam no
            celular mesmo com o app fechado.
          </Text>
        </View>
        <Pressable onPress={dispensar} accessibilityRole="button" accessibilityLabel="Dispensar" hitSlop={8}>
          <X size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>
      <View className="flex-row gap-2">
        {bloqueada ? (
          <Button className="flex-1" onPress={() => void Linking.openSettings()}>
            <Text>Abrir ajustes do sistema</Text>
          </Button>
        ) : (
          <Button className="flex-1" loading={push.ativar.isPending} onPress={() => push.ativar.mutate()}>
            <Text>Ativar agora</Text>
          </Button>
        )}
        <Button variant="ghost" onPress={dispensar}>
          <Text>Agora não</Text>
        </Button>
      </View>
      {push.ativar.error ? (
        <Text className="text-xs text-destructive">
          Não foi possível ativar agora. Tente de novo em Configurações.
        </Text>
      ) : null}
    </View>
  )
}
