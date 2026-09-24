import '../global.css'

import { ThemeProvider } from '@react-navigation/native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack, usePathname, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/poppins'
import { Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope'

import { ColorSchemeProvider, useTheme } from '@/components/color-scheme-provider'
import { opcoesDePilha } from '@/components/shell/cabecalho-de-vidro'
import { SessionProvider, useSession } from '@/lib/auth'
import { canOpenOnMobile, landingRoute } from '@/lib/linking'
import { NAV_THEME } from '@/lib/theme'

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Mobile networks: one silent retry, then show the error state.
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  })
}

/**
 * The root gate. Three rules, in this order:
 *   1. no session                → /login, and nothing else exists
 *   2. must_change_password      → /alterar-senha, and nothing else exists
 *   3. a route into a module the perfil doesn't grant (or a webOnly one, e.g.
 *      admin, reached via a deep link) → bounced to the landing route
 *
 * It lives here rather than in each screen because a deep link (jobsiteos:///…
 * from a push notification) can land on ANY route without passing through one.
 */
function RootGate({ children }: { children: ReactNode }) {
  const { user, usuario, grantedModuleIds, loading } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const { colors } = useTheme()

  useEffect(() => {
    if (loading) return

    const onLogin = pathname === '/login'
    const onChangePassword = pathname === '/alterar-senha'

    if (!user) {
      if (!onLogin) router.replace('/login')
      return
    }

    if (usuario?.must_change_password === true) {
      if (!onChangePassword) router.replace('/alterar-senha')
      return
    }

    // /alterar-senha is NOT bounced here: with the flag already false it is the
    // voluntary "alterar senha" flow reached from Configurações.
    if (onLogin) {
      router.replace(landingRoute(grantedModuleIds))
      return
    }

    if (!canOpenOnMobile(pathname, grantedModuleIds)) {
      router.replace(landingRoute(grantedModuleIds))
    }
  }, [loading, user, usuario, grantedModuleIds, pathname, router])

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  return <>{children}</>
}

function RootNavigator() {
  const { scheme, colors } = useTheme()

  return (
    <ThemeProvider value={NAV_THEME[scheme]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <RootGate>
        {/*
          `opcoesDePilha` aqui também, e não só no <ModuleStack>: as telas com
          header deste stack (Configurações e o report do deep link) ficavam com o
          tema PADRÃO do React Navigation, e o header saía com outro fundo e outro
          tom ao lado de qualquer tela de módulo.
        */}
        <Stack screenOptions={{ headerShown: false, ...opcoesDePilha(colors) }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          {/* No back gesture, no header: it is a wall, not a step. */}
          <Stack.Screen name="alterar-senha" options={{ gestureEnabled: false }} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="configuracoes"
            options={{
              headerShown: true,
              title: 'Configurações',
              presentation: 'card',
            }}
          />
          {/*
            O destino do deep link de report (04m §4). Fora de (tabs) de propósito:
            um report não pertence a módulo nenhum — reportar é direito de qualquer
            usuário ativo — e a rota precisa existir para o push abrir em algum lugar.
          */}
          <Stack.Screen
            name="reports/[id]"
            options={{
              headerShown: true,
              title: 'Report',
              presentation: 'card',
            }}
          />
        </Stack>
      </RootGate>
    </ThemeProvider>
  )
}

export default function RootLayout() {
  // One client for the app's lifetime; useState so Fast Refresh doesn't wipe the
  // cache on every save.
  const [queryClient] = useState(makeQueryClient)

  /*
   * AS DUAS FAMÍLIAS, E POR QUE SÃO DUAS.
   *
   * Poppins é o texto: leitura, rótulo, número. Manrope entra SÓ nos títulos de
   * tela ("Funil", "Mais", "JobsiteOS") — é mais estreita e mais dura, e a
   * diferença entre as duas é o que dá hierarquia sem precisar de mais um
   * tamanho de corpo.
   *
   * Enquanto não carregam, a tela fica em branco em vez de renderizar na fonte
   * do sistema: um flash de Helvetica e depois Poppins reposiciona cada linha
   * do app, e isso é mais feio que meio segundo de espera.
   */
  const [fontesProntas] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  })

  if (!fontesProntas) return <View style={{ flex: 1, backgroundColor: '#050e40' }} />

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ColorSchemeProvider>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <RootNavigator />
            </SessionProvider>
          </QueryClientProvider>
        </ColorSchemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
