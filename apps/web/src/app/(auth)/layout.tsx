import type { ReactNode } from 'react'

/**
 * Shell for the unauthenticated screens. Deliberately has no sidebar, no bell
 * and no AI bar: nothing here may render anything that assumes a session.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  )
}
