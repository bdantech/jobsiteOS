'use client'

import * as React from 'react'

/**
 * Debounces the *value*, not the handler, so the input stays perfectly
 * responsive (it is uncontrolled by the timer) while the query key — and
 * therefore the request — only changes once the user stops typing.
 */
export function useDebounce<T>(valor: T, atrasoMs = 300): T {
  const [debounced, setDebounced] = React.useState(valor)

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(valor), atrasoMs)
    return () => window.clearTimeout(timer)
  }, [valor, atrasoMs])

  return debounced
}
