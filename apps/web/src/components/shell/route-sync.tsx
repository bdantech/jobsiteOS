'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { useTabsHydrated, useTabsStoreApi } from '@/components/shell/tabs-store-provider'
import { cleanDocumentTitle, titleForRoute } from '@/components/shell/route-title'

/**
 * The bridge between the Next router and the tab store. Renders nothing.
 *
 * Three jobs:
 *  1. the active tab always points at the current URL;
 *  2. the active tab's title follows the page's <title>;
 *  3. cmd/ctrl+click and middle-click on an internal link open an app tab instead of a
 *     browser tab.
 *
 * Everything here waits for `hydrated`. Acting before localStorage has been read would
 * create a tab for the current route, then have rehydration overwrite it — the user's
 * restored tabs would silently vanish on every reload.
 */
export function RouteSync() {
  const pathname = usePathname()
  const store = useTabsStoreApi()
  const hydrated = useTabsHydrated()

  // 1. Route → active tab. Normal (non-cmd) navigation reuses the active tab, exactly
  //    like a browser: clicking a link does not spawn a tab.
  React.useEffect(() => {
    if (!hydrated) return
    store.getState().syncRoute(pathname, titleForRoute(pathname))
  }, [hydrated, pathname, store])

  // 2. <title> → active tab title. Observing the head rather than the <title> node
  //    itself is deliberate: Next's metadata updates can REPLACE the element, which
  //    would leave an observer bound to the old node watching a detached tree forever.
  React.useEffect(() => {
    if (!hydrated) return

    const apply = () => {
      const title = cleanDocumentTitle(document.title)
      if (title) store.getState().renameActiveTab(title)
    }

    apply()

    const observer = new MutationObserver(apply)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [hydrated, store])

  // 3. Modified clicks on internal links.
  React.useEffect(() => {
    if (!hydrated) return

    const openInNewTab = (route: string) => {
      // Background tab, like a browser: your place is not stolen. It holds only the
      // route and fetches for the first time when you activate it.
      store.getState().openTab(route, titleForRoute(route), { activate: false })
    }

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (!event.metaKey && !event.ctrlKey) return

      const route = internalRoute(event.target)
      if (!route) return

      // Without preventDefault the browser opens its own tab (Next's Link deliberately
      // ignores modified clicks and lets the browser win). Capture phase, so we decide
      // before any handler on the link itself runs.
      event.preventDefault()
      event.stopPropagation()
      openInNewTab(route)
    }

    // Middle click. `mousedown` is where the browser arms the autoscroll cursor and
    // `auxclick` is where it opens its tab — both have to be refused.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 1) return
      if (!internalRoute(event.target)) return
      event.preventDefault()
    }

    const onAuxClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 1) return

      const route = internalRoute(event.target)
      if (!route) return

      event.preventDefault()
      event.stopPropagation()
      openInNewTab(route)
    }

    document.addEventListener('click', onClick, true)
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('auxclick', onAuxClick, true)

    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('auxclick', onAuxClick, true)
    }
  }, [hydrated, store])

  return null
}

/**
 * The pathname of the same-origin link under `target`, or null when this click is not
 * ours to steal — external host, `target="_blank"`, a download, a pure hash link, or an
 * element carrying `data-no-tab` (the opt-out for any link that must keep native
 * behaviour).
 */
function internalRoute(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null

  const anchor = target.closest('a')
  if (!anchor) return null

  const href = anchor.getAttribute('href')
  if (!href || href.startsWith('#')) return null
  if (anchor.hasAttribute('download')) return null
  if (anchor.hasAttribute('data-no-tab')) return null

  const target_ = anchor.getAttribute('target')
  if (target_ && target_ !== '_self') return null

  let url: URL
  try {
    url = new URL(anchor.href, window.location.origin)
  } catch {
    return null
  }

  if (url.origin !== window.location.origin) return null

  // Pathname only — see the note at the top of stores/tabs.ts.
  return url.pathname
}
