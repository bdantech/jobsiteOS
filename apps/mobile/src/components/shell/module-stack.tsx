import { Stack } from 'expo-router'
import type { ReactNode } from 'react'
import { View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { HeaderActions } from '@/components/shell/header-actions'
import { BannerBeta } from '@/features/reports'

export interface ModuleStackProps {
  /** The module's <Stack.Screen> declarations. */
  children?: ReactNode
  /** Sino + botão de reportar no headerRight. Off inside the notificações module itself. */
  bell?: boolean
}

/**
 * The per-module navigator. Every module folder under app/(tabs) renders one of
 * these instead of a raw <Stack>, which is what makes the module chrome uniform:
 * themed header, themed content background, as ações de header em toda tela que o
 * módulo empilha — e, desde o 04m, a tarja de beta.
 *
 * A TARJA VEM DO `screenLayout`, e não de um <View> em volta do <Stack>.
 * `screenLayout` embrulha CADA TELA, ou seja: ela renderiza dentro da tela, logo
 * abaixo do header nativo. Acima do navegador ela brigaria com o inset de status
 * bar que o header nativo calcula por conta própria, e o resultado seria uma
 * faixa em branco entre a tarja e o título — diferente em cada plataforma.
 */
export function ModuleStack({ children, bell = true }: ModuleStackProps) {
  const { colors } = useTheme()

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerTitleStyle: { color: colors.foreground },
        contentStyle: { backgroundColor: colors.background },
        headerRight: bell ? () => <HeaderActions /> : undefined,
      }}
      screenLayout={({ children: tela }) => (
        <View className="flex-1">
          <BannerBeta />
          {tela}
        </View>
      )}
    >
      {children}
    </Stack>
  )
}
