import { grantedMobileModules } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ChevronRight, LogOut, Settings } from 'lucide-react-native'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '@/components/color-scheme-provider'
import { ModuleGrid } from '@/components/shell/module-grid'
import { Avatar } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { BannerBeta } from '@/features/reports'
import { useSession } from '@/lib/auth'

/**
 * The 5th tab: the full module grid plus the account block. It is the app's
 * safety net — `initialRouteName`, and the landing route for a user whose perfil
 * grants no mobile module — so it must render something useful with zero modules
 * and zero data. The grid handles that with its own empty state.
 */
export default function MaisScreen() {
  const { usuario, loading, signOut, grantedModuleIds } = useSession()
  const router = useRouter()
  const { colors } = useTheme()
  const { top: topo } = useSafeAreaInsets()
  // A contagem é dos módulos que ABREM no app, não de todos os liberados: o
  // grid mostra os webOnly acinzentados, e dizer "9 no app" sobre uma grade que
  // inclui um card riscado seria contar o que não se pode tocar.
  const quantos = grantedMobileModules(grantedModuleIds).length

  return (
    <View className="flex-1 bg-card">
      <StatusBar style="light" />
      {/* Esta tela não passa por <ModuleStack>, que é quem injeta a tarja nas
          demais. Sem esta linha, "Mais" seria a única tela sem o aviso de beta. */}
      <BannerBeta />

      <ScrollView contentContainerClassName="pb-28" showsVerticalScrollIndicator={false}>
        {/*
          O CABEÇALHO NAVY com a conta dentro dele.
          
          A conta subiu para cá porque ela é o assunto desta tela, não um item
          da lista: "Mais" é onde se troca de módulo E onde se cuida de quem
          está logado. Deixá-la como primeira linha de um scroll branco fazia
          as duas coisas parecerem do mesmo peso.
        */}
        <View className="gap-6 bg-brand px-5 pb-12" style={{ paddingTop: topo + 12 }}>
          <View className="flex-row items-center justify-between gap-3">
            <Text className="font-display text-[30px] leading-[40px] tracking-tight text-white">
              Mais
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Configurações"
              onPress={() => router.push('/configuracoes')}
              className="size-11 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] active:opacity-70"
            >
              <Settings size={20} color="#FFFFFF" />
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir configurações da conta"
            onPress={() => router.push('/configuracoes')}
            className="flex-row items-center gap-3.5 rounded-lg border border-white/10 bg-white/[0.06] p-3.5 active:opacity-70"
          >
            {loading ? (
              <>
                <Skeleton className="size-13 rounded-full" />
                <View className="flex-1 gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </View>
              </>
            ) : (
              <>
                <Avatar nome={usuario?.nome ?? '?'} size="lg" />
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="text-[17px] font-bold text-white">
                    {usuario?.nome ?? 'Usuário'}
                  </Text>
                  <Text numberOfLines={1} className="text-[13px] text-[#CBD5E1]">
                    {usuario?.email ?? ''}
                  </Text>
                </View>
                <ChevronRight size={20} color="#8FB4E0" />
              </>
            )}
          </Pressable>
        </View>

        {/* A folha branca sobe por cima do navy — a mesma dobra do login. */}
        <View className="-mt-6 gap-4 rounded-t-2xl bg-card px-5 pb-8 pt-7">
          <View className="flex-row items-baseline justify-between">
            <Text className="text-lg font-bold text-foreground">Módulos</Text>
            <Text className="text-xs text-muted-foreground">{quantos} no app</Text>
          </View>

          <ModuleGrid />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sair da conta"
            onPress={() => void signOut()}
            className="mt-3 h-[52px] flex-row items-center justify-center gap-2.5 rounded-md border border-border bg-card active:border-destructive"
          >
            <LogOut size={20} color={colors.destructive} />
            <Text className="text-[15px] font-semibold text-destructive">Sair da conta</Text>
          </Pressable>

          <Text className="text-center text-xs text-muted-foreground">JobsiteOS · v2.4.0</Text>
        </View>
      </ScrollView>
    </View>
  )
}
