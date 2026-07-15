import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@jobsiteos/core'

/**
 * Browser client. Anon key + the user's session cookie, so every query runs
 * with RLS applied as that user. Safe to import from a client component.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
