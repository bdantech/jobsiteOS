'use client'

import * as React from 'react'
import { ThemeProvider } from 'next-themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Client-side providers for the whole app. Mounted once by the root layout.
 *
 * The QueryClient is created inside a state initialiser, not at module scope:
 * on the server a module-scope client would be shared across every concurrent
 * request, leaking one user's cached data into another's render.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Most reads are RSC-rendered; React Query backs the interactive
            // bits (bell, AI Bar). A short stale window keeps refetch storms down.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  )
}
