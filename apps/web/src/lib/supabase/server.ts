import 'server-only'

import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { Database } from '@jobsiteos/core'

/**
 * createServerClient is overloaded (the deprecated get/set/remove shape and the
 * current getAll/setAll one). TypeScript contextually types our object literal
 * against the FIRST overload, which has no `setAll` — so the parameter would be
 * an implicit `any` under `strict`. Annotating it explicitly is what pins the
 * correct overload.
 */
type CookieToSet = { name: string; value: string; options: CookieOptions }

/**
 * User-scoped server client, for RSCs, server actions and route handlers.
 *
 * This is the client to pass to the write helpers (criarEmpresa, atualizarEmpresa,
 * criarNota) and to ToolContext.supabase: it carries the caller's session, so
 * RLS and the SECURITY INVOKER functions see the real user.
 *
 * `cookies()` is async in Next 15, so this function is too.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component, where cookies are read-only. The
            // middleware (updateSession) is what actually refreshes the session
            // cookie, so swallowing this is correct and not a lost write.
          }
        },
      },
    },
  )
}
