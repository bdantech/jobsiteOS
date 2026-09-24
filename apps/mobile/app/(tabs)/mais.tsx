import { grantedMobileModules } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ChevronRight, LogOut, Settings } from 'lucide-react-native'
import { Pressable, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import {
  BotaoDoCabecalho,
  CabecalhoFixo,
  useRecuoDoCabecalho,
} from '@/components/shell/cabecalho-de-vidro'
import { ModuleGrid } from '@/components/shell/module-grid'
import { ReportButton } from '@/components/shell/report-button'
import { Avatar } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { ConviteNotificacoes } from '@/features/auth/components/convite-notificacoes'
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
  const recuo = useRecuoDoCabecalho()
  // A contagem é dos módulos que ABREM no app, não de todos os liberados: o
  // grid mostra os webOnly acinzentados, e dizer "9 no app" sobre uma grade que
  // inclui um card riscado seria contar o que não se pode tocar.
  const quantos = grantedMobileModules(grantedModuleIds).length

  return (
    <View className="flex-1 bg-card">
      <StatusBar style="light" />

      <ScrollView contentContainerClassName="pb-28" showsVerticalScrollIndicator={false}>
        {/*
          O BLOCO NAVY com a conta dentro dele.

          A conta mora aqui porque ela é o assunto desta tela, não um item da
          lista: "Mais" é onde se troca de módulo E onde se cuida de quem está
          logado. Deixá-la como primeira linha de um scroll branco fazia as duas
          coisas parecerem do mesmo peso.

          O recuo do cabeçalho entra DENTRO do navy, e não no container: parado,
          o vidro fica sobre navy e emenda com o bloco; rolando, o bloco passa
          por baixo dele como qualquer lista.
        */}
        <View className="bg-brand px-5 pb-12" style={{ paddingTop: recuo + 12 }}>
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
          {/* Antes dos módulos: é o que faz o resto do app chegar sem ser aberto. */}
          <ConviteNotificacoes />

          <View className="flex-row items-baseline justify-between">
            <Text className="text-lg font-bold text-foreground">Módulos</Text>
            <Text className="text-xs text-muted-foreground">{quantos} no app</Text>
          </View>

          <ModuleGrid />

          <View className="mt-3">
            <ReportButton />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sair da conta"
            onPress={() => void signOut()}
            className="h-[52px] flex-row items-center justify-center gap-2.5 rounded-md border border-border bg-card active:border-destructive"
          >
            <LogOut size={20} color={colors.destructive} />
            <Text className="text-[15px] font-semibold text-destructive">Sair da conta</Text>
          </Pressable>

          <Text className="text-center text-xs text-muted-foreground">JobsiteOS · v2.4.0</Text>
        </View>
      </ScrollView>

      {/*
        O cabeçalho comum, recolhido: esta tela não tem busca nem filtro. Ela
        não passa por um <ModuleStack>, então o monta à mão — por cima do
        scroll, e por isso depois dele.
      */}
      <View className="absolute left-0 right-0 top-0">
        <CabecalhoFixo
          titulo="Mais"
          extra={
            <BotaoDoCabecalho
              accessibilityLabel="Configurações"
              onPress={() => router.push('/configuracoes')}
            >
              <Settings size={20} color="#FFFFFF" />
            </BotaoDoCabecalho>
          }
        />
      </View>
    </View>
  )
}
