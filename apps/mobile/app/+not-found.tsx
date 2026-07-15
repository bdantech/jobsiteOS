import { Stack, useRouter } from 'expo-router'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useSession } from '@/lib/auth'
import { landingRoute } from '@/lib/linking'

/** A deep link into a route this build doesn't have (e.g. a module shipped on
 *  web first) lands here instead of a blank screen. */
export default function NotFoundScreen() {
  const router = useRouter()
  const { grantedModuleIds } = useSession()

  return (
    <>
      <Stack.Screen options={{ title: 'Não encontrado' }} />
      <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text variant="title" className="text-center">
          Página não encontrada
        </Text>
        <Text variant="muted" className="text-center">
          Este endereço não existe no aplicativo. Ele pode estar disponível apenas na versão web.
        </Text>
        <Button variant="outline" onPress={() => router.replace(landingRoute(grantedModuleIds))}>
          <Text>Voltar ao início</Text>
        </Button>
      </View>
    </>
  )
}
