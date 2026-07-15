import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@jobsiteos/core'

/** See the note in server.ts: createServerClient's overloads force this annotation. */
type CookieToSet = { name: string; value: string; options: CookieOptions }

/**
 * Refreshes the Supabase session cookie on every request and hands back both
 * the response carrying the refreshed cookies and the authenticated user.
 *
 * The caller (src/middleware.ts, written by the auth agent) decides policy —
 * where to redirect an anonymous user, how to handle must_change_password, and
 * how to apply canAccessRoute(). This helper only does the cookie plumbing, so
 * that logic lives in exactly one place instead of being split across files.
 *
 * IMPORTANT: whoever calls this must return the returned `response` (or copy its
 * cookies onto their own), or the refreshed session is dropped and the user gets
 * logged out at random.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: CookieToSet[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // getUser(), never getSession(): getUser() revalidates the JWT against the
  // auth server, so a revoked or tampered token is rejected here rather than
  // being trusted because it merely parses.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { response, user, supabase }
}
