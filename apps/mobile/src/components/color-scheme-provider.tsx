import { useColorScheme as useNativeWindColorScheme } from 'nativewind'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'

import { COLORS, type ColorTokens } from '@/lib/theme'
import { useColorSchemeStore, type ThemePreference } from '@/store/color-scheme'

export interface ThemeState {
  /** The scheme actually in effect right now. */
  scheme: 'light' | 'dark'
  /** Raw token values for props that can't take a className. */
  colors: ColorTokens
  /** What the user picked: 'system' | 'light' | 'dark'. */
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
}

/**
 * Reads the persisted preference and hands it to NativeWind, which is what
 * actually flips the `dark:` variants and the CSS variables in global.css.
 */
export function ColorSchemeProvider({ children }: { children: ReactNode }) {
  const preference = useColorSchemeStore((state) => state.preference)
  const hydrated = useColorSchemeStore((state) => state.hydrated)
  const { setColorScheme } = useNativeWindColorScheme()

  useEffect(() => {
    setColorScheme(preference)
  }, [preference, setColorScheme])

  if (!hydrated) {
    // AsyncStorage hasn't answered yet. Painting the tree now would show it in
    // the system scheme and then snap to the user's override.
    return <View className="flex-1 bg-background" />
  }

  return <>{children}</>
}

/** The one hook screens should use for anything colour-related. */
export function useTheme(): ThemeState {
  const { colorScheme } = useNativeWindColorScheme()
  const preference = useColorSchemeStore((state) => state.preference)
  const setPreference = useColorSchemeStore((state) => state.setPreference)

  const scheme: 'light' | 'dark' = colorScheme === 'dark' ? 'dark' : 'light'

  return { scheme, colors: COLORS[scheme], preference, setPreference }
}
