import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

interface PushDispositivoState {
  /** Did the user turn push ON for THIS device? */
  optIn: boolean
  /** Last token we successfully registered, so we can unregister it later. */
  token: string | null
  hydrated: boolean
  marcarAtivo: (token: string) => void
  marcarInativo: () => void
  setHydrated: () => void
}

/**
 * Local, per-install state. It is NOT the source of truth — the server's
 * expo_push_tokens is — but it answers two questions the server can't:
 *
 *  1. "Is the switch on?" cannot be derived from the OS permission alone: a user
 *     may have granted permission and still turned OUR switch off.
 *  2. Unregistering needs the token, and once permission is revoked in the OS
 *     settings the token can no longer be minted. Keeping the last one lets us
 *     still remove it from the server.
 *
 * Persisted with AsyncStorage, not SecureStore: an Expo push token is not a
 * credential, and SecureStore is the session's.
 */
export const usePushDispositivoStore = create<PushDispositivoState>()(
  persist(
    (set) => ({
      optIn: false,
      token: null,
      hydrated: false,
      marcarAtivo: (token) => set({ optIn: true, token }),
      // The token is kept: it is what we send to /api/push/expo to unregister,
      // and re-enabling later simply overwrites it.
      marcarInativo: () => set({ optIn: false }),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'jobsiteos.push-dispositivo',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ optIn: state.optIn, token: state.token }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated()
      },
    },
  ),
)
