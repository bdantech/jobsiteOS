'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * The viewport below which the sidebar stops being a sidebar and becomes a drawer.
 *
 * 1024px — Tailwind's `lg`, the breakpoint this shell has always used. shadcn's own
 * hook ships 768px, but that number has to agree with the CSS in components/ui/sidebar.tsx
 * (`hidden lg:flex` on the desktop panel): if JS and CSS disagree about what "mobile" is,
 * the band between the two breakpoints renders neither the drawer nor the sidebar.
 */
export const MOBILE_BREAKPOINT = 1024

/**
 * Read as an external store rather than in an effect, so React has the answer during
 * render instead of after it — no "desktop on first paint, drawer on second" flicker.
 *
 * The server snapshot is `false` on purpose: SSR emits the desktop markup (see Sidebar),
 * so claiming mobile here would make the first client render disagree with the HTML that
 * was streamed. On a phone the desktop panel is hidden by CSS (`hidden lg:flex`), so
 * nothing of it is ever visible in the window between hydration and the first snapshot.
 */
export function useIsMobile(): boolean {
  const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onStoreChange)
      return () => list.removeEventListener('change', onStoreChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
  const getServerSnapshot = useCallback(() => false, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
