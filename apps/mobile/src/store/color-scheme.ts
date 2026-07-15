import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ThemePreference = 'system' | 'light' | 'dark'

interface ColorSchemeState {
  /** What the user chose. 'system' means "follow the OS", which is the default. */
  preference: ThemePreference
  /** False until the persisted preference has been read back from disk. */
  hydrated: boolean
  setPreference: (preference: ThemePreference) => void
  setHydrated: () => void
}

/**
 * Only the *preference* lives here. The resolved scheme (light | dark) is owned
 * by NativeWind — ColorSchemeProvider pushes this value into it. One source of
 * truth, so the `dark:` class variant and the raw COLORS lookup can never
 * disagree for a frame.
 */
export const useColorSchemeStore = create<ColorSchemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      hydrated: false,
      setPreference: (preference) => set({ preference }),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'jobsiteos.color-scheme',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ preference: state.preference }),
      // Rehydration is async on native; the provider waits for this before it
      // paints, so a dark-mode user never sees a white flash on cold start.
      onRehydrateStorage: () => (state) => {
        state?.setHydrated()
      },
    },
  ),
)
