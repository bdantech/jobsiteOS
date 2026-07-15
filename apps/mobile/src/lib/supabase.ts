import 'react-native-url-polyfill/auto'

import type { Database } from '@jobsiteos/core'
import { createClient } from '@supabase/supabase-js'
import { AppState } from 'react-native'

import { secureStorage } from './secure-storage'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail at import, not at the first query: an EXPO_PUBLIC_* var is inlined at
  // build time, so a missing one is a broken build, not a runtime condition.
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY são obrigatórias. Copie apps/mobile/.env.example para apps/mobile/.env.',
  )
}

/**
 * The user-scoped client: anon key + the signed-in session. Every query runs
 * under RLS. There is no service-role client on mobile — anything that needs one
 * (push token registration, notification prefs, admin writes) goes through the
 * Next.js backend via src/lib/api.ts.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No URL to read a session from: mobile finishes auth in-process, and the
    // deep-link scheme must not be parsed for tokens.
    detectSessionInUrl: false,
  },
})

/**
 * Supabase's timer-based refresh keeps firing while the app is backgrounded, and
 * on iOS that burns a refresh cycle the OS may never let complete. Drive it off
 * the app's foreground state instead — this is the documented RN setup.
 */
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh()
  } else {
    void supabase.auth.stopAutoRefresh()
  }
})
