import { useRouter } from 'expo-router'
import { LogOut, Settings } from 'lucide-react-native'
import { Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useTheme } from '@/components/color-scheme-provider'
import { ModuleGrid } from '@/components/shell/module-grid'
import { ScreenHeader } from '@/components/shell/screen-header'
import { Avatar } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { useSession } from '@/lib/auth'

/**
 * The 5th tab: the full module grid plus the account block. It is the app's
 * safety net — `initialRouteName`, and the landing route for a user whose perfil
 * grants no mobile module — so it must render something useful with zero modules
 * and zero data. The grid handles that with its own empty state.
 */
export default function MaisScreen() {
  const { usuario, loading, signOut } = useSession()
  const router = useRouter()
  const { colors } = useTheme()

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader title="Mais" />

      <ScrollView contentContainerClassName="gap-6 p-4 pb-24">
        <View className="flex-row items-center gap-3">
          {loading ? (
            <>
              <Skeleton className="h-12 w-12 rounded-full" />
              <View className="flex-1 gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </View>
            </>
          ) : (
            <>
              <Avatar nome={usuario?.nome ?? '?'} size="lg" />
              <View className="flex-1">
                <Text variant="heading">{usuario?.nome ?? 'Usuário'}</Text>
                <Text variant="muted">{usuario?.email ?? ''}</Text>
              </View>
            </>
          )}
        </View>

        <View className="gap-3">
          <Text variant="label">Módulos</Text>
          <ModuleGrid />
        </View>

        <View className="gap-3">
          <Text variant="label">Conta</Text>

          <Card>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Configurações"
              onPress={() => router.push('/configuracoes')}
              className="flex-row items-center gap-3 p-4 active:opacity-70"
            >
              <Settings size={18} color={colors.mutedForeground} />
              <Text>Configurações</Text>
            </Pressable>

            <Separator />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sair"
              onPress={() => void signOut()}
              className="flex-row items-center gap-3 p-4 active:opacity-70"
            >
              <LogOut size={18} color={colors.destructive} />
              <Text className="text-destructive">Sair</Text>
            </Pressable>
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
