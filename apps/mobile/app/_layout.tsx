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

import { ColorSchemeProvider, useTheme } from '@/components/color-scheme-provider'
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
  const { scheme } = useTheme()

  return (
    <ThemeProvider value={NAV_THEME[scheme]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <RootGate>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          {/* No back gesture, no header: it is a wall, not a step. */}
          <Stack.Screen name="alterar-senha" options={{ gestureEnabled: false }} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="configuracoes"
            options={{ headerShown: true, title: 'Configurações', presentation: 'card' }}
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
