import { Stack } from 'expo-router'
import type { ReactNode } from 'react'

import { useTheme } from '@/components/color-scheme-provider'
import { HeaderBell } from '@/components/shell/header-bell'

export interface ModuleStackProps {
  /** The module's <Stack.Screen> declarations. */
  children?: ReactNode
  /** Notifications bell in headerRight. Off inside the notificações module itself. */
  bell?: boolean
}

/**
 * The per-module navigator. Every module folder under app/(tabs) renders one of
 * these instead of a raw <Stack>, which is what makes the module chrome uniform:
 * themed header, themed content background, and the notifications bell in the
 * header of every screen the module pushes.
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
        headerRight: bell ? () => <HeaderBell /> : undefined,
      }}
    >
      {children}
    </Stack>
  )
}
